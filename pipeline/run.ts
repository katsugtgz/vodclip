// Pipeline runner — the 48h-harness entry point.
//   bun pipeline/run.ts <vodId> [--top N]
// Stages: chat (TDC file or download) → detect → judge → preview → (queue separately).

import { $ } from "bun";
import { serveQueue } from "./queue.ts";
import { pathsFor, stageChat, stageDetect, stageJudge, stagePreview, vodUrl } from "./stages.ts";
import { Store } from "./store.ts";

const WORK_ROOT = process.env.VODCLIP_WORK_ROOT ?? `${import.meta.dir}/../work`;

async function downloadChat(vodId: string, workDir: string): Promise<string> {
  const out = `${workDir}/chat-${vodId}.json`;
  if (await Bun.file(out).exists()) return out;
  const tdc = process.env.VODCLIP_TDC_PATH ?? `${process.env.HOME}/bin/TwitchDownloaderCLI`;
  const proc = Bun.spawn([tdc, "chatdownload", "--id", vodId, "-o", out, "-b", "1000"],
    { stdout: "pipe", stderr: "pipe" });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`chatdownload failed: ${await new Response(proc.stderr).text()}`.slice(-400));
  return out;
}

async function main() {
  const vodId = process.argv[2];
  const topN = Number(process.argv.find((a) => a.startsWith("--top"))?.split("=")[1] ?? 10);
  if (!vodId || !/^\d+$/.test(vodId)) {
    console.error("usage: bun pipeline/run.ts <twitchVodId> [--top=10]");
    process.exit(1);
  }
  const paths = pathsFor(WORK_ROOT, vodId);
  await $`mkdir -p ${paths.workDir} ${paths.clipsDir}`;
  const store = new Store(paths.dbPath);

  console.log(`[1/4] chat — ${vodId}`);
  const chatPath = await downloadChat(vodId, paths.workDir);
  const doc = await stageChat(store, vodId, chatPath);
  console.log(`      ${doc.msgs.length.toLocaleString()} msgs, ${Math.round(doc.lengthSec / 60)} min`);

  console.log("[2/4] detect");
  const { candidates, hash } = stageDetect(store, doc);
  console.log(`      ${candidates.length} candidates (hash ${hash})`);

  const judgeDone = store.getStage(vodId, "judge")?.status === "done";
  if (judgeDone) {
    const c: any = store.db.query("SELECT COUNT(*) n, SUM(status='ok') ok FROM verdicts WHERE vod_id=$v").get({ $v: vodId });
    console.log(`[3/4] judge — already done (${c.ok}/${c.n} ok), skipping`);
  } else {
    console.log(`[3/4] judge ${candidates.length} candidates (GLM)`);
    const judgeRes = await stageJudge(store, doc, candidates, hash);
    console.log(`      ok=${judgeRes.okCount} judge_error=${judgeRes.errCount}`);
  }

  console.log(`[4/4] preview top ${topN}`);
  const ranked = store.queue(vodId, topN).map((v: any) => ({
    candidateId: v.candidate_id,
    cutStart: v.adjusted_cut_start_sec ?? 0,
    cutEnd: v.adjusted_cut_end_sec ?? 0,
  }));
  const prev = await stagePreview(store, vodId, ranked, paths.workDir, topN);
  console.log(`      previews made=${prev.made} failed=${prev.failed}`);

  store.close();
  console.log(`\nnext: bun pipeline/queue.ts ${vodId}  → review blind-first, precision@10 scoreboard`);
}

await main();
