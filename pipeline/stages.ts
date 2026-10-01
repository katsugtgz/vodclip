// Pipeline state machine (amendment #6): idempotent stage entry points.
// A crash at hour 10 resumes from the last done stage, never restarts.

import type { Candidate, ChatDoc } from "./types.ts";
import { DEFAULT_DETECT_CONFIG, detect, hashConfig, type DetectConfig } from "./detect.ts";
import { loadTdcChatFile } from "./chat.ts";
import { judgeCandidate } from "./judge.ts";
import { fetchSection, render916, ffmpegThumb } from "./preview.ts";
import { Store } from "./store.ts";

export { DEFAULT_DETECT_CONFIG };

export interface RunPaths {
  workDir: string;   // per-VOD working dir
  dbPath: string;    // shared pipeline DB
  clipsDir: string;  // LAN pickup folder
}

export function pathsFor(workRoot: string, vodId: string): RunPaths {
  return {
    workDir: `${workRoot}/${vodId}`,
    dbPath: `${workRoot}/vodclip.sqlite`,
    clipsDir: `${workRoot}/clips`,
  };
}

export const vodUrl = (vodId: string) => `https://www.twitch.tv/videos/${vodId}`;

export async function stageChat(store: Store, vodId: string, chatPath: string): Promise<ChatDoc> {
  store.setStage(vodId, "chat", "running");
  try {
    const doc = await loadTdcChatFile(chatPath, vodId);
    store.setStage(vodId, "chat", "done", `${doc.msgs.length} msgs, ${Math.round(doc.lengthSec / 60)} min`);
    return doc;
  } catch (e: any) {
    store.setStage(vodId, "chat", "error", String(e?.message ?? e));
    throw e;
  }
}

export function stageDetect(
  store: Store, doc: ChatDoc, cfg: Partial<DetectConfig> = {},
): { candidates: Candidate[]; hash: string } {
  store.setStage(doc.vodId, "detect", "running");
  const merged = { ...DEFAULT_DETECT_CONFIG, ...cfg };
  const hash = hashConfig(merged);
  const { candidates, diagnostics } = detect(doc, cfg);
  store.upsertVod({
    vodId: doc.vodId, streamer: doc.streamer, title: doc.title, lengthSec: doc.lengthSec,
    candidatesTotal: candidates.length, detectorConfigHash: hash, createdAt: new Date().toISOString(),
  });
  store.setStage(doc.vodId, "detect", "done",
    `${candidates.length} candidates | vol ratio ${diagnostics.volumeRatio.toFixed(1)}x | median ${diagnostics.medianMsgsPerMin}/min`);
  return { candidates, hash };
}

/** Rough pre-cut previews for the top-N judged candidates (amendment #3). */
export async function stagePreview(
  store: Store, vodId: string, ranked: { candidateId: string; cutStart: number; cutEnd: number }[], workDir: string, topN = 10,
): Promise<{ made: number; failed: number }> {
  store.setStage(vodId, "preview", "running");
  let made = 0, failed = 0;
  for (const r of ranked.slice(0, topN)) {
    const out = `${workDir}/prev-${r.candidateId}.mp4`;
    if (await Bun.file(out).exists()) { made++; continue; } // idempotent
    const res = await fetchSection(vodUrl(vodId), r.cutStart, r.cutEnd, out);
    if (res.ok) { made++; await ffmpegThumb(out, out.replace(/\.mp4$/, ".jpg"), 1); }
    else { failed++; }
  }
  store.setStage(vodId, "preview", "done", `${made} previews, ${failed} failed`);
  return { made, failed };
}

export async function stageJudge(
  store: Store, doc: ChatDoc, candidates: Candidate[], detectorConfigHash: string,
): Promise<{ okCount: number; errCount: number }> {
  store.setStage(doc.vodId, "judge", "running");
  let okCount = 0, errCount = 0;
  for (const cand of candidates) {
    const v = await judgeCandidate(doc, cand, detectorConfigHash);
    store.insertVerdict(v);
    if (v.status === "ok") okCount++; else errCount++;
  }
  store.setStage(doc.vodId, "judge", "done", `${okCount} ok, ${errCount} judge_error`);
  return { okCount, errCount };
}

/** Final 9:16 render after a Keep (amendment #2: failures surface, never lose output silently). */
export async function renderKept(
  store: Store, workDir: string, clipsDir: string, candidateId: string, cutStart: number, cutEnd: number,
): Promise<{ ok: boolean; path: string | null; detail: string }> {
  const src = `${workDir}/prev-${candidateId}.mp4`;
  const out = `${clipsDir}/${candidateId}-916.mp4`;
  if (!(await Bun.file(src).exists())) {
    const got = await fetchSection(vodUrl(candidateId.split("-c")[0]), cutStart, cutEnd, src);
    if (!got.ok) { store.setStage(candidateId.split("-c")[0], "review", "error", `render src missing: ${got.detail}`); return { ok: false, path: null, detail: got.detail }; }
  }
  const r = await render916(src, out);
  return { ok: r.ok, path: r.ok ? out : null, detail: r.detail };
}
