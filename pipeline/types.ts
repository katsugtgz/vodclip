// Shared pipeline types. Pure data, no side effects.

export interface ChatMsg {
  /** Seconds from VOD start (TDC content_offset_seconds). */
  t: number;
  /** Emote-ish tokens extracted from fragments + ALLCAPS words in body. */
  tokens: string[];
  /** True for system/usernotice events (raid, sub, gift) — filtered before scoring. */
  system: boolean;
  /** Raw body for judge context. */
  body: string;
  /** Commenter login or null for system messages. */
  user: string | null;
}

export interface ChatDoc {
  vodId: string;
  streamer: string;
  title: string;
  lengthSec: number;
  msgs: ChatMsg[];
}

export interface Candidate {
  id: string;
  vodId: string;
  /** Apex second (peak convergence bucket center). */
  apexSec: number;
  /** Judging window [start, end] seconds — ±90s merged, clamped to VOD bounds. */
  windowStartSec: number;
  windowEndSec: number;
  /** Proposed cut (apex −5s → +25s), clamped. */
  cutStartSec: number;
  cutEndSec: number;
  /** Convergence score (token z-score sum). */
  score: number;
  /** Top contributing tokens with their z at apex. */
  topTokens: { token: string; z: number; count: number }[];
  /** Median msgs/min of session (background reference). */
  msgsPerMin: number;
}

export interface Verdict {
  id?: number;
  vodId: string;
  candidateId: string;
  promptVersion: string;
  judgeInputVariant: string;
  detectorConfigHash: string;
  isHighlight: boolean | null;
  keepProb: number | null;
  whatHappened: string | null;
  score: number | null;
  adjustedCutStartSec: number | null;
  adjustedCutEndSec: number | null;
  flags: string[];
  /** ok | judge_error */
  status: "ok" | "judge_error";
  errorKind: string | null;
  raw: string;
  createdAt: string;
}

export interface ReviewAction {
  verdictId: number;
  action: "keep" | "kill";
  /** >5s delta from proposal = override. */
  cutDeltaSec: number;
  isOverride: boolean;
  blindDurationMs: number;
  createdAt: string;
}

export type StageName = "download" | "chat" | "detect" | "judge" | "preview" | "review";
export type StageStatus = "pending" | "running" | "done" | "error";

export interface StageState {
  vodId: string;
  stage: StageName;
  status: StageStatus;
  detail: string | null;
  updatedAt: string;
}
