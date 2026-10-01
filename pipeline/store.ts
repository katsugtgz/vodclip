// SQLite store — WAL mode, verdict identity per amendment #1, stage states
// per amendment #6, INSERT-only judge outputs (never overwrite).

import { Database } from "bun:sqlite";
import type { ReviewAction, StageName, StageStatus, Verdict } from "./types.ts";

export interface VodRow {
  vodId: string;
  streamer: string;
  title: string;
  lengthSec: number;
  candidatesTotal: number;
  detectorConfigHash: string;
  createdAt: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS vods (
  vod_id TEXT PRIMARY KEY,
  streamer TEXT NOT NULL,
  title TEXT NOT NULL,
  length_sec INTEGER NOT NULL,
  candidates_total INTEGER NOT NULL,
  detector_config_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS verdicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vod_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  judge_input_variant TEXT NOT NULL,
  detector_config_hash TEXT NOT NULL,
  is_highlight INTEGER,
  keep_prob REAL,
  what_happened TEXT,
  score REAL,
  adjusted_cut_start_sec INTEGER,
  adjusted_cut_end_sec INTEGER,
  flags TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,           -- ok | judge_error
  error_kind TEXT,
  raw TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_verdicts_vod ON verdicts(vod_id, candidate_id);
CREATE TABLE IF NOT EXISTS review_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  verdict_id INTEGER NOT NULL,
  action TEXT NOT NULL,           -- keep | kill
  cut_delta_sec INTEGER NOT NULL,
  is_override INTEGER NOT NULL,
  blind_duration_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stages (
  vod_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (vod_id, stage)
);
`;

export class Store {
  private db: Database;

  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(SCHEMA);
  }

  upsertVod(row: VodRow): void {
    this.db
      .query(`INSERT INTO vods (vod_id, streamer, title, length_sec, candidates_total, detector_config_hash, created_at)
              VALUES ($vodId, $streamer, $title, $lengthSec, $candidatesTotal, $hash, $createdAt)
              ON CONFLICT(vod_id) DO UPDATE SET candidates_total=$candidatesTotal, detector_config_hash=$hash`)
      .run({ $vodId: row.vodId, $streamer: row.streamer, $title: row.title, $lengthSec: row.lengthSec,
             $candidatesTotal: row.candidatesTotal, $hash: row.detectorConfigHash, $createdAt: row.createdAt });
  }

  insertVerdict(v: Omit<Verdict, "id">): number {
    const r = this.db
      .query(`INSERT INTO verdicts (vod_id, candidate_id, prompt_version, judge_input_variant, detector_config_hash,
                is_highlight, keep_prob, what_happened, score, adjusted_cut_start_sec, adjusted_cut_end_sec,
                flags, status, error_kind, raw, created_at)
              VALUES ($vodId, $candidateId, $pv, $jiv, $dch, $ih, $kp, $wh, $sc, $acs, $ace, $fl, $st, $ek, $raw, $ca)`)
      .run({
        $vodId: v.vodId, $candidateId: v.candidateId, $pv: v.promptVersion, $jiv: v.judgeInputVariant,
        $dch: v.detectorConfigHash, $ih: v.isHighlight === null ? null : v.isHighlight ? 1 : 0,
        $kp: v.keepProb, $wh: v.whatHappened, $sc: v.score, $acs: v.adjustedCutStartSec, $ace: v.adjustedCutEndSec,
        $fl: JSON.stringify(v.flags ?? []), $st: v.status, $ek: v.errorKind, $raw: v.raw, $ca: v.createdAt,
      });
    return Number(r.lastInsertRowid);
  }

  insertReviewAction(a: Omit<ReviewAction, "id">): void {
    this.db
      .query(`INSERT INTO review_actions (verdict_id, action, cut_delta_sec, is_override, blind_duration_ms, created_at)
              VALUES ($v, $a, $d, $o, $b, $c)`)
      .run({ $v: a.verdictId, $a: a.action, $d: a.cutDeltaSec, $o: a.isOverride ? 1 : 0, $b: a.blindDurationMs, $c: a.createdAt });
  }

  setStage(vodId: string, stage: StageName, status: StageStatus, detail: string | null = null): void {
    this.db
      .query(`INSERT INTO stages (vod_id, stage, status, detail, updated_at) VALUES ($v, $s, $st, $d, $u)
              ON CONFLICT(vod_id, stage) DO UPDATE SET status=$st, detail=$d, updated_at=$u`)
      .run({ $v: vodId, $s: stage, $st: status, $d: detail, $u: new Date().toISOString() });
  }

  getStage(vodId: string, stage: StageName): { status: StageStatus; detail: string | null } | null {
    const r = this.db.query(`SELECT status, detail FROM stages WHERE vod_id=$v AND stage=$s`).get({ $v: vodId, $s: stage }) as any;
    return r ? { status: r.status, detail: r.detail } : null;
  }

  /** Review-queue view: latest ok-verdict per candidate, ranked by keep_prob. */
  queue(vodId: string, limit = 10): any[] {
    return this.db
      .query(`SELECT v.*, CASE WHEN ra.id IS NOT NULL THEN 1 ELSE 0 END AS reviewed
              FROM verdicts v
              LEFT JOIN review_actions ra ON ra.verdict_id = v.id
              WHERE v.vod_id=$vod AND v.status='ok'
                AND v.id = (SELECT MAX(v2.id) FROM verdicts v2 WHERE v2.vod_id=v.vod_id AND v2.candidate_id=v.candidate_id AND v2.status='ok')
              ORDER BY (v.keep_prob IS NULL), v.keep_prob DESC
              LIMIT $limit`)
      .all({ $vod: vodId, $limit: limit });
  }

  precisionAt10(vodId: string): { kept: number; total: number } {
    const rows = this.db
      .query(`SELECT ra.action FROM review_actions ra JOIN verdicts v ON v.id = ra.verdict_id
              WHERE v.vod_id=$vod AND v.candidate_id IN (
                SELECT candidate_id FROM verdicts WHERE vod_id=$vod AND status='ok'
                GROUP BY candidate_id HAVING id = MAX(id))
              ORDER BY (SELECT keep_prob FROM verdicts v3 WHERE v3.candidate_id=v.candidate_id AND v3.status='ok' AND v3.id=(SELECT MAX(id) FROM verdicts WHERE candidate_id=v.candidate_id AND status='ok')) DESC`)
      .all({ $vod: vodId }) as { action: string }[];
    const top10 = rows.slice(0, 10);
    return { kept: top10.filter((r) => r.action === "keep").length, total: top10.length };
  }

  close(): void {
    this.db.close();
  }
}
