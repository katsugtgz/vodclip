// ASR layer for judge-v2: transcript of the candidate cut window.
// Engines: Wispr Flow REST (primary, WISPR_API_KEY) / faster-whisper local
// (fallback). Both emit {text, engine}; the judge verdict records which
// engine fed it via judge_input_variant.

import type { Candidate } from "./types.ts";

const WISPR_URL = process.env.WISPRFLOW_URL ?? "https://api.wisprflow.ai/api";
const WISPR_KEY = process.env.WISPR_API_KEY ?? "";

/** ffmpeg-extract 16kHz mono wav from a section of the preview file. */
export async function extractWav16k(srcMp4: string, startSec: number, endSec: number, outWav: string): Promise<boolean> {
  const proc = Bun.spawn([
    "ffmpeg", "-y", "-ss", String(Math.max(0, startSec)), "-to", String(endSec),
    "-i", srcMp4, "-ac", "1", "-ar", "16000", "-vn", outWav,
  ], { stdout: "pipe", stderr: "pipe" });
  return (await proc.exited) === 0;
}

export interface AsrResult {
  text: string;
  engine: "wispr" | "whisper-local";
  detectedLanguage: string | null;
}

export function wisprAvailable(): boolean {
  return WISPR_KEY.length > 0;
}

export async function transcribeWispr(wavPath: string, dictionary: string[]): Promise<AsrResult> {
  const b64 = Buffer.from(await Bun.file(wavPath).arrayBuffer()).toString("base64");
  const res = await fetch(WISPR_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${WISPR_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      audio: b64,
      language: ["en"],
      context: {
        app: { type: "other" },
        dictionary_context: dictionary.slice(0, 50),
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`wispr http_${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const j: any = await res.json();
  return { text: (j.text ?? "").trim(), engine: "wispr", detectedLanguage: j.detected_language ?? null };
}

export async function transcribeWhisperLocal(wavPath: string): Promise<AsrResult> {
  // wav is already 16kHz mono PCM — read via stdlib `wave` into a float32
  // numpy array, bypassing faster-whisper's PyAV decode (av 19 dropped
  // `metadata_errors`, which faster-whisper still passes).
  const proc = Bun.spawn(
    ["python3", "-c", `
import wave, json, sys
import numpy as np
from faster_whisper import WhisperModel
w = wave.open(sys.argv[1], "rb")
audio = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
m = WhisperModel("small", device="cpu", compute_type="int8")
segs, info = m.transcribe(audio, beam_size=5)
print(json.dumps({"text": " ".join(s.text.strip() for s in segs).strip(), "lang": info.language}))
`, wavPath],
    { stdout: "pipe", stderr: "pipe" },
  );
  const code = await proc.exited;
  const out = await new Response(proc.stdout).text();
  if (code !== 0) throw new Error(`whisper failed: ${(await new Response(proc.stderr).text()).slice(-200)}`);
  const j = JSON.parse(out.trim().split("\n").at(-1)!);
  return { text: j.text, engine: "whisper-local", detectedLanguage: j.lang ?? null };
}

export async function transcribe(wavPath: string, dictionary: string[] = []): Promise<AsrResult> {
  if (wisprAvailable()) return transcribeWispr(wavPath, dictionary);
  return transcribeWhisperLocal(wavPath);
}

/** Dictionary for Wispr: emote tokens + streamer + title keywords. */
export function dictionaryFor(cand: Candidate, streamer: string): string[] {
  const words = cand.topTokens.map((t) => t.token).filter((w) => /^[A-Za-z0-9]{2,15}$/.test(w));
  return [...new Set([streamer, ...words])];
}
