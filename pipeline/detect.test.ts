import { test, describe } from "bun:test";
import { expect } from "bun:test";
import { loadTdcChat } from "./chat.ts";
import { detect, hashConfig, DEFAULT_DETECT_CONFIG } from "./detect.ts";
import type { ChatDoc, ChatMsg } from "./types.ts";

const fixture = await Bun.file("test/fixtures/chat-sample.json").text();
const doc = loadTdcChat(JSON.parse(fixture), "2887458706");

function synth(msgs: ChatMsg[], lengthSec = 3600): ChatDoc {
  return { vodId: "synth", streamer: "s", title: "", lengthSec, msgs };
}
const msg = (t: number, tokens: string[], body = tokens.join(" "), system = false): ChatMsg =>
  ({ t, tokens, system, body, user: system ? null : "u" });

describe("chat loader", () => {
  test("parses TDC fixture, extracts emote tokens from fragments", () => {
    expect(doc.msgs.length).toBeGreaterThan(10000);
    expect(doc.lengthSec).toBe(20400);
    const withTokens = doc.msgs.filter((m) => m.tokens.length > 0);
    expect(withTokens.length).toBeGreaterThan(1000);
    expect(doc.msgs.every((m) => m.system === false)).toBe(true); // comments-only TDC file
  });
});

describe("detector: real data (xQc boat-heist fixture)", () => {
  test("top apex lands at the measured emote peak; ranking + geometry sane", () => {
    const { candidates, diagnostics } = detect(doc);
    expect(candidates.length).toBeGreaterThanOrEqual(3);
    // Emote peak measured at min 312 (18720s) — the TOP candidate must land
    // inside the climax window 305–335 min. (Detector surfaces convergence
    // events everywhere; "is it a highlight" is the judge's job, not the
    // detector's — so we only pin the ranking claim, not candidate absence.)
    const top = candidates[0];
    expect(top.apexSec).toBeGreaterThan(305 * 60);
    expect(top.apexSec).toBeLessThan(335 * 60);
    // Window + cut geometry per spec.
    expect(top.cutEndSec - top.cutStartSec).toBeLessThanOrEqual(31);
    expect(top.cutStartSec).toBeGreaterThanOrEqual(0);
    expect(diagnostics.medianMsgsPerMin).toBeGreaterThan(0);
  });

  test("respects maxCandidates cap", () => {
    const { candidates } = detect(doc, { maxCandidates: 5 });
    expect(candidates.length).toBeLessThanOrEqual(5);
  });
});

describe("detector: guards", () => {
  test("empty chat → no candidates, no crash", () => {
    const r = detect(synth([]));
    expect(r.candidates).toEqual([]);
    expect(r.diagnostics.totalMsgs).toBe(0);
  });

  test("flat σ=0 chat (same tokens every bucket) → no spike candidates", () => {
    const msgs: ChatMsg[] = [];
    for (let t = 0; t < 3600; t += 2) msgs.push(msg(t, ["EZ"]));
    const r = detect(synth(msgs));
    // Perfectly flat rate → z≈0 everywhere → no candidates above threshold.
    expect(r.candidates).toEqual([]);
  });

  test("spike in a single token produces a candidate with that token on top", () => {
    const msgs: ChatMsg[] = [];
    for (let t = 0; t < 3600; t += 2) msgs.push(msg(t, ["EZ"])); // baseline
    for (let t = 1800; t < 1830; t += 0.5) msgs.push(msg(t, ["HUH", "OOOO"])); // 30s spike
    const r = detect(synth(msgs));
    expect(r.candidates.length).toBeGreaterThan(0);
    const top = r.candidates[0];
    expect(top.topTokens.map((x) => x.token)).toContain("HUH");
    expect(Math.abs(top.apexSec - 1815)).toBeLessThanOrEqual(16);
  });

  test("usernotice/system messages are excluded from scoring", () => {
    const msgs: ChatMsg[] = [];
    for (let t = 0; t < 3600; t += 2) msgs.push(msg(t, ["EZ"]));
    for (let t = 1700; t < 1730; t += 0.5) msgs.push(msg(t, ["SUB"], "sub wall", true)); // raid wall
    const r = detect(synth(msgs));
    expect(r.diagnostics.systemMsgsFiltered).toBe(60);
    expect(r.candidates).toEqual([]); // without system filter this would spike
  });

  test("NMS merges adjacent spikes within nmsSec", () => {
    const msgs: ChatMsg[] = [];
    for (let t = 0; t < 3600; t += 2) msgs.push(msg(t, ["EZ"]));
    for (let t = 1800; t < 1815; t += 0.5) msgs.push(msg(t, ["HUH"]));
    for (let t = 1815; t < 1830; t += 0.5) msgs.push(msg(t, ["HUH"]));
    const r = detect(synth(msgs));
    expect(r.candidates.filter((c) => Math.abs(c.apexSec - 1822) < 60).length).toBe(1);
  });

  test("boundary clamps: apex near start/end stays inside [0, length]", () => {
    const msgs: ChatMsg[] = [];
    for (let t = 0; t < 1200; t += 2) msgs.push(msg(t, ["EZ"]));
    for (let t = 10; t < 40; t += 0.5) msgs.push(msg(t, ["HUH"])); // spike at t≈25
    for (let t = 1160; t < 1195; t += 0.5) msgs.push(msg(t, ["HUH"])); // spike near end
    const r = detect(synth(msgs, 1200));
    for (const c of r.candidates) {
      expect(c.cutStartSec).toBeGreaterThanOrEqual(0);
      expect(c.cutEndSec).toBeLessThanOrEqual(1200);
      expect(c.windowStartSec).toBeGreaterThanOrEqual(0);
      expect(c.windowEndSec).toBeLessThanOrEqual(1200);
    }
  });
});

describe("config hash", () => {
  test("stable and config-sensitive", () => {
    expect(hashConfig(DEFAULT_DETECT_CONFIG)).toBe(hashConfig({ ...DEFAULT_DETECT_CONFIG }));
    expect(hashConfig({ ...DEFAULT_DETECT_CONFIG, minZ: 4 })).not.toBe(hashConfig(DEFAULT_DETECT_CONFIG));
  });
});
