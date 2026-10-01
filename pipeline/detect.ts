// Emote-convergence detector (v1, per design addendum #7):
// primary signal = per-bucket convergence of specific emote tokens, z-scored
// against that token's session baseline RATE (count/bucket msgs — background
// volume normalization); raw msgs/min is reported, not scored. Guards: σ=0
// floor, empty chat, VOD-boundary clamps, usernotice filter, NMS, top-N cap.

import type { Candidate, ChatDoc, ChatMsg } from "./types.ts";

export interface DetectConfig {
  bucketSec: number;      // 10
  windowSec: number;      // 90 (± judging window)
  cutLeadSec: number;     // 5  (apex − lead)
  cutTailSec: number;     // 25 (apex + tail)
  minZ: number;           // token counts toward score when z ≥ minZ (3)
  minTokenTotal: number;  // ignore tokens seen < N times in session (5)
  nmsSec: number;         // non-max suppression distance (60)
  maxCandidates: number;  // top-20 pre-judge cap
  topTokensReported: number;
}

export const DEFAULT_DETECT_CONFIG: DetectConfig = {
  bucketSec: 10, windowSec: 90, cutLeadSec: 5, cutTailSec: 25,
  minZ: 3, minTokenTotal: 5, nmsSec: 60, maxCandidates: 20, topTokensReported: 5,
};

export function hashConfig(cfg: DetectConfig): string {
  const s = JSON.stringify(cfg);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

export interface DetectResult {
  candidates: Candidate[];
  diagnostics: {
    totalMsgs: number;
    systemMsgsFiltered: number;
    activeMinutes: number;
    medianMsgsPerMin: number;
    loudestMsgsPerMin: number;
    volumeRatio: number;
    scannedTokens: number;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function detect(doc: ChatDoc, cfgIn: Partial<DetectConfig> = {}): DetectResult {
  const cfg = { ...DEFAULT_DETECT_CONFIG, ...cfgIn };
  const { msgs, lengthSec, vodId } = doc;

  const chatMsgs = msgs.filter((m) => !m.system);
  const systemCount = msgs.length - chatMsgs.length;
  const diagnostics = {
    totalMsgs: msgs.length,
    systemMsgsFiltered: systemCount,
    activeMinutes: 0, medianMsgsPerMin: 0, loudestMsgsPerMin: 0,
    volumeRatio: 0, scannedTokens: 0,
  };
  if (chatMsgs.length === 0) return { candidates: [], diagnostics };

  const nBuckets = Math.max(1, Math.ceil(lengthSec / cfg.bucketSec));
  const bucketMsgs = new Float64Array(nBuckets);
  // token → per-bucket counts
  const tokenBuckets = new Map<string, Float64Array>();

  for (const m of chatMsgs as ChatMsg[]) {
    const b = clamp(Math.floor(m.t / cfg.bucketSec), 0, nBuckets - 1);
    bucketMsgs[b]++;
    for (const tok of m.tokens) {
      let arr = tokenBuckets.get(tok);
      if (!arr) { arr = new Float64Array(nBuckets); tokenBuckets.set(tok, arr); }
      arr[b]++;
    }
  }

  // volume diagnostics (per-minute)
  const perMin = new Map<number, number>();
  for (const m of chatMsgs) perMin.set(Math.floor(m.t / 60), (perMin.get(Math.floor(m.t / 60)) ?? 0) + 1);
  const mins = [...perMin.values()].sort((a, b) => a - b);
  diagnostics.activeMinutes = mins.length;
  diagnostics.medianMsgsPerMin = mins.length ? mins[Math.floor(mins.length / 2)] : 0;
  diagnostics.loudestMsgsPerMin = mins.length ? mins.at(-1)! : 0;
  diagnostics.volumeRatio = diagnostics.medianMsgsPerMin > 0
    ? diagnostics.loudestMsgsPerMin / diagnostics.medianMsgsPerMin : 0;

  // per-token rate baseline: rate = count / bucketMsgs (volume-normalized).
  // Baseline uses ACTIVE buckets only (bucketMsgs > 0) — empty buckets are
  // missing data, not a zero-rate observation.
  const activeBuckets: number[] = [];
  for (let b = 0; b < nBuckets; b++) if (bucketMsgs[b] > 0) activeBuckets.push(b);
  const tokenStats = new Map<string, { mean: number; sd: number; total: number }>();
  for (const [tok, arr] of tokenBuckets) {
    let total = 0;
    for (let b = 0; b < nBuckets; b++) total += arr[b];
    if (total < cfg.minTokenTotal || activeBuckets.length === 0) continue;
    let sum = 0;
    for (const b of activeBuckets) sum += arr[b] / bucketMsgs[b];
    const mean = sum / activeBuckets.length;
    let sq = 0;
    for (const b of activeBuckets) sq += arr[b] / bucketMsgs[b] - mean;
    sq = 0;
    for (const b of activeBuckets) sq += (arr[b] / bucketMsgs[b] - mean) ** 2;
    const sd = Math.sqrt(sq / activeBuckets.length);
    tokenStats.set(tok, { mean, sd, total });
  }
  diagnostics.scannedTokens = tokenStats.size;

  // convergence score per bucket
  const score = new Float64Array(nBuckets);
  const zAt = new Map<string, Float64Array>();
  for (const [tok, st] of tokenStats) {
    const arr = tokenBuckets.get(tok)!;
    const zs = new Float64Array(nBuckets);
    const denom = Math.max(st.sd, 1e-4); // σ=0 floor → z≈0 on flat, spikes still register
    for (let b = 0; b < nBuckets; b++) {
      const rate = bucketMsgs[b] > 0 ? arr[b] / bucketMsgs[b] : 0;
      const z = (rate - st.mean) / denom;
      zs[b] = z;
      if (z >= cfg.minZ) score[b] += z * Math.log1p(st.total);
    }
    zAt.set(tok, zs);
  }

  // apex candidates: local maxima with NMS
  const order = [...score.keys()].filter((b) => score[b] > 0)
    .sort((a, b) => score[b] - score[a]);
  const chosen: number[] = [];
  for (const b of order) {
    if (chosen.every((c) => Math.abs(c - b) * cfg.bucketSec >= cfg.nmsSec)) chosen.push(b);
    if (chosen.length >= cfg.maxCandidates) break;
  }

  const candidates: Candidate[] = chosen.map((b) => {
    const apexSec = clamp(b * cfg.bucketSec + cfg.bucketSec / 2, 0, lengthSec);
    const toks = [...tokenStats.entries()]
      .map(([tok, st]) => ({ token: tok, z: zAt.get(tok)![b], count: tokenBuckets.get(tok)![b], total: st.total }))
      .filter((x) => x.z >= cfg.minZ)
      .sort((a, b2) => b2.z * Math.log1p(b2.total) - a.z * Math.log1p(a.total))
      .slice(0, cfg.topTokensReported)
      .map(({ token, z, count }) => ({ token, z: +z.toFixed(2), count }));
    return {
      id: `${vodId}-c${b}`,
      vodId,
      apexSec: Math.round(apexSec),
      windowStartSec: Math.max(0, Math.round(apexSec - cfg.windowSec)),
      windowEndSec: Math.min(lengthSec, Math.round(apexSec + cfg.windowSec)),
      cutStartSec: Math.max(0, Math.round(apexSec - cfg.cutLeadSec)),
      cutEndSec: Math.min(lengthSec, Math.round(apexSec + cfg.cutTailSec)),
      score: +score[b].toFixed(2),
      topTokens: toks,
      msgsPerMin: diagnostics.medianMsgsPerMin,
    };
  });

  return { candidates, diagnostics };
}
