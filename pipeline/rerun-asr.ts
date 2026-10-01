// Reprocess: judge-v2 (chat + audio transcript) over all detected candidates.
//   bun pipeline/rerun-asr.ts <vodId>
// Audio: reuse existing pre-cut mp4s where present; otherwise fetch an
// audio-only section via yt-dlp. ASR: Wispr Flow if WISPR_API_KEY is set,
// else faster-whisper local. Verdicts INSERT-only with variant chat+asr-*.

import { $ } from "bun";
import { loadTdcChatFile } from "./chat.ts";
import { detect } from "./detect.ts";
import { judgeCandidateV2 } from "./judge.ts";
import { transcribe, extractWav16k, dictionaryFor, wisprAvailable } from "./asr.ts";
import { Store } from "./store.ts";
import { vodUrl } from "./stages.ts";

const WORK_ROOT = process.env.VODCLIP_WORK_ROOT ?? `${import.meta.dir}/../work`;

async function fetchAudioSection(vodId: string, startSec: number, endSec: number, outPath: string): Promise<boolean> {
  if (await Bun.file(outPath).exists()) return true;
  const proc = Bun.spawn([
    "yt-dlp", "-f", "ba", "--download-sections", `*${Math.max(0, startSec - 2)}-${endSec + 2}`,
    "--force-keyframes-at-cuts", "-o", outPath, "--no-playlist", vodUrl(vodId),
  ], { stdout: "pipe", stderr: "pipe" });
  return (await proc.exited) === 0;
}

async function main() {
  const vodId = process.argv[2];
  if (!vodId) { console.error("usage: bun pipeline/rerun-asr.ts <vodId>"); process.exit(1); }
  const workDir = `${WORK_ROOT}/${vodId}`;
  const store = new Store(`${WORK_ROOT}/vodclip.sqlite`);
  const engineNote = wisprAvailable() ? "Wispr Flow" : "faster-whisper local (WISPR_API_KEY not set)";
  console.log(`rerun-asr: engine = ${engineNote}`);

  const doc = await loadTdcChatFile(`${workDir}/chat-${vodId}.json`, vodId);
  const { candidates } = detect(doc);
  console.log(`candidates: ${candidates.length}`);

  const v1: any[] = store.db
    .query(`SELECT candidate_id, keep_prob, what_happened FROM verdicts
            WHERE vod_id=$v AND prompt_version='judge-v1' AND status='ok'
            AND id=(SELECT MAX(id) FROM verdicts WHERE vod_id=$v AND candidate_id=verdicts.candidate_id AND prompt_version='judge-v1')`)
    .all({ $v: vodId });

  let n = 0;
  for (const cand of candidates) {
    n++;
    const wav = `${workDir}/asr-${cand.id}.wav`;
    const srcMp4 = `${workDir}/prev-${cand.id}.mp4`;
    let ok: boolean;
    if (await Bun.file(srcMp4).exists()) {
      ok = await extractWav16k(srcMp4, 0, cand.cutEndSec - cand.cutStartSec, wav);
    } else {
      const raw = `${workDir}/asrsrc-${cand.id}.m4a`;
      ok = await fetchAudioSection(vodId, cand.cutStartSec, cand.cutEndSec, raw);
      if (ok) ok = await extractWav16k(raw, 0, cand.cutEndSec - cand.cutStartSec, wav);
    }
    if (!ok) { console.log(`  [${n}/${candidates.length}] ${cand.id} AUDIO FAIL`); continue; }

    let asr;
    try {
      asr = await transcribe(wav, dictionaryFor(cand, doc.streamer));
    } catch (e: any) {
      console.log(`  [${n}/${candidates.length}] ${cand.id} ASR FAIL: ${String(e?.message ?? e).slice(0, 120)}`);
      continue;
    }
    const verdict = await judgeCandidateV2(doc, cand, "detect-v1", { transcript: asr.text, asrEngine: asr.engine });
    store.insertVerdict(verdict);
    const old = v1.find((x) => x.candidate_id === cand.id);
    const dKp = old?.keep_prob != null && verdict.keepProb != null ? (verdict.keepProb - old.keep_prob).toFixed(2) : "?";
    console.log(`  [${n}/${candidates.length}] ${cand.id} kp ${old?.keep_prob ?? "?"} → ${verdict.keepProb ?? "?"} (Δ${dKp}) [${asr.engine}] ${verdict.whatHappened?.slice(0, 80) ?? verdict.errorKind}`);
  }
  store.close();
  console.log("done — verdicts appended with variant chat+asr-*; queue ranks on latest per candidate.");
}

await main();
