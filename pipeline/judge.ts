// GLM judge — chat-only verdict per candidate. Failure contract (amendment #2):
// malformed/empty/refusal/HTTP-error outputs land as judge_error, NEVER as
// "not a highlight". Judge outputs are INSERT-only (store handles that).

import type { Candidate, ChatDoc, Verdict } from "./types.ts";

const BASE = process.env.VODCLIP_ANTHROPIC_BASE_URL ?? "https://api.z.ai/api/anthropic";
const MODEL = process.env.VODCLIP_JUDGE_MODEL ?? "glm-5.3-flash";
const KEY = process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY ?? "";

export const JUDGE_PROMPT_VERSION = "judge-v1";
const JUDGE_INPUT_VARIANT = "chatwin-300";

export interface JudgeEvidence {
  transcript?: string;
  asrEngine?: string;
}

export async function judgeCandidateV2(
  doc: ChatDoc,
  cand: Candidate,
  detectorConfigHash: string,
  evidence: JudgeEvidence,
): Promise<Omit<Verdict, "id">> {
  const system = await Bun.file("prompts/judge-v2-asr.md").text();
  const chatPart = buildUserPrompt(doc, cand);
  const transcript = (evidence.transcript ?? "").trim();
  const user = `STREAM AUDIO TRANSCRIPT (cut window):\n${transcript || "(empty — flag transcript_unclear if chat alone is insufficient)"}\n\n---\n\n${chatPart}`;
  const base = {
    vodId: doc.vodId,
    candidateId: cand.id,
    promptVersion: "judge-v2-asr",
    judgeInputVariant: `chat+asr-${evidence.asrEngine ?? "none"}`,
    detectorConfigHash,
    createdAt: new Date().toISOString(),
  };
  const v = await callWithRetry(system, user);
  return { ...base, ...v.parsed, status: v.status, errorKind: v.errorKind, raw: v.raw.slice(0, 4000) };
}

async function callWithRetry(
  system: string, user: string,
): Promise<{ parsed: Partial<ParsedVerdict> | null; status: "ok" | "judge_error"; errorKind: string | null; raw: string }> {
  let lastErr = "unknown";
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    let out: { status: number; text: string };
    try {
      out = await callGlm(system, user);
    } catch (e: any) {
      lastErr = e?.name === "TimeoutError" ? "timeout" : "network";
      out = { status: 0, text: "" };
    }
    if (out.status === 429 || out.status >= 500 || out.status === 0) {
      lastErr = out.status === 429 ? "http_429" : out.status >= 500 ? `http_${out.status}` : lastErr;
      if (attempt < RETRIES) { await Bun.sleep(1500 * (attempt + 1)); continue; }
      return { parsed: null, status: "judge_error", errorKind: lastErr, raw: "" };
    }
    if (!out.text.trim()) {
      if (attempt < RETRIES) continue;
      return { parsed: null, status: "judge_error", errorKind: "empty", raw: "" };
    }
    if (/i can't|i cannot|i'm unable/i.test(out.text) && !out.text.includes("{")) {
      return { parsed: null, status: "judge_error", errorKind: "refusal", raw: out.text };
    }
    const parsed = extractVerdictJson(out.text);
    if (!parsed) {
      if (attempt < RETRIES) continue;
      return { parsed: null, status: "judge_error", errorKind: "parse_error", raw: out.text.slice(0, 2000) };
    }
    return { parsed, status: "ok", errorKind: null, raw: out.text };
  }
  return { parsed: null, status: "judge_error", errorKind: lastErr, raw: "" };
}
const MAX_WINDOW_MSGS = 300;
const RETRIES = 2;
const TIMEOUT_MS = 60_000;

export interface ParsedVerdict {
  isHighlight: boolean | null;
  keepProb: number | null;
  whatHappened: string | null;
  score: number | null;
  adjustedCutStartSec: number | null;
  adjustedCutEndSec: number | null;
  flags: string[];
}

export function extractVerdictJson(text: string): ParsedVerdict | null {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  let obj: any;
  try { obj = JSON.parse(text.slice(s, e + 1)); } catch { return null; }
  if (typeof obj !== "object" || obj === null) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    isHighlight: typeof obj.is_highlight === "boolean" ? obj.is_highlight : null,
    keepProb: num(obj.keep_prob),
    whatHappened: typeof obj.what_happened === "string" && obj.what_happened.trim() ? obj.what_happened.trim() : null,
    score: num(obj.score),
    adjustedCutStartSec: num(obj.adjusted_cut_start_sec),
    adjustedCutEndSec: num(obj.adjusted_cut_end_sec),
    flags: Array.isArray(obj.flags) ? obj.flags.filter((f: unknown) => typeof f === "string") : [],
  };
}

function buildUserPrompt(doc: ChatDoc, cand: Candidate): string {
  const window = doc.msgs
    .filter((m) => !m.system && m.t >= cand.windowStartSec && m.t <= cand.windowEndSec)
    .slice(-MAX_WINDOW_MSGS);
  const lines = window.map((m) => `${Math.round(m.t)}s ${m.user ?? "?"}: ${m.body.replace(/\s+/g, " ").slice(0, 140)}`);
  return [
    `STREAM: ${doc.streamer} — ${doc.title}`,
    `VOD LENGTH: ${Math.round(doc.lengthSec / 60)} min. SESSION MEDIAN: ${cand.msgsPerMin} msgs/min.`,
    `CANDIDATE: apex at ${cand.apexSec}s; proposed cut ${cand.cutStartSec}s–${cand.cutEndSec}s.`,
    `TOP CONVERGING TOKENS: ${cand.topTokens.map((t) => `${t.token} (z=${t.z})`).join(", ") || "none"}`,
    `CHAT TRANSCRIPT (window ${cand.windowStartSec}s–${cand.windowEndSec}s, last ${lines.length} messages):`,
    ...lines,
  ].join("\n");
}

async function callGlm(system: string, user: string): Promise<{ status: number; text: string }> {
  const res = await fetch(`${BASE}/v1/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      stream: false,
      system,
      messages: [{ role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status !== 200) { await res.text().catch(() => {}); return { status: res.status, text: "" }; }
  const j: any = await res.json();
  const text = (j.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
  return { status: 200, text };
}

export async function judgeCandidate(
  doc: ChatDoc,
  cand: Candidate,
  detectorConfigHash: string,
): Promise<Omit<Verdict, "id">> {
  const system = await Bun.file("prompts/judge-v1.md").text();
  const user = buildUserPrompt(doc, cand);
  const base = {
    vodId: doc.vodId,
    candidateId: cand.id,
    promptVersion: JUDGE_PROMPT_VERSION,
    judgeInputVariant: JUDGE_INPUT_VARIANT,
    detectorConfigHash,
    createdAt: new Date().toISOString(),
  };

  let lastErr = "unknown";
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    let out: { status: number; text: string };
    try {
      out = await callGlm(system, user);
    } catch (e: any) {
      lastErr = e?.name === "TimeoutError" ? "timeout" : "network";
      out = { status: 0, text: "" };
    }
    if (out.status === 429 || out.status >= 500 || out.status === 0) {
      lastErr = out.status === 429 ? "http_429" : out.status >= 500 ? `http_${out.status}` : lastErr;
      if (attempt < RETRIES) { await Bun.sleep(1500 * (attempt + 1)); continue; }
      return { ...base, isHighlight: null, keepProb: null, whatHappened: null, score: null,
        adjustedCutStartSec: null, adjustedCutEndSec: null, flags: [], status: "judge_error", errorKind: lastErr, raw: "" };
    }
    if (!out.text.trim()) {
      lastErr = "empty";
      if (attempt < RETRIES) continue;
      return { ...base, isHighlight: null, keepProb: null, whatHappened: null, score: null,
        adjustedCutStartSec: null, adjustedCutEndSec: null, flags: [], status: "judge_error", errorKind: "empty", raw: "" };
    }
    if (/i can't|i cannot|i'm unable/i.test(out.text) && !out.text.includes("{")) {
      return { ...base, isHighlight: null, keepProb: null, whatHappened: null, score: null,
        adjustedCutStartSec: null, adjustedCutEndSec: null, flags: [], status: "judge_error", errorKind: "refusal", raw: out.text };
    }
    const parsed = extractVerdictJson(out.text);
    if (!parsed) {
      lastErr = "parse_error";
      if (attempt < RETRIES) continue;
      return { ...base, isHighlight: null, keepProb: null, whatHappened: null, score: null,
        adjustedCutStartSec: null, adjustedCutEndSec: null, flags: [], status: "judge_error", errorKind: "parse_error", raw: out.text.slice(0, 2000) };
    }
    return { ...base, ...parsed, status: "ok", errorKind: null, raw: out.text.slice(0, 4000) };
  }
  return { ...base, isHighlight: null, keepProb: null, whatHappened: null, score: null,
    adjustedCutStartSec: null, adjustedCutEndSec: null, flags: [], status: "judge_error", errorKind: lastErr, raw: "" };
}
