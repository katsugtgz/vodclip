import { test, describe } from "bun:test";
import { expect } from "bun:test";
import { extractVerdictJson } from "./judge.ts";

describe("judge output parsing (failure contract: garbage never becomes 'not a highlight')", () => {
  test("parses a clean one-line JSON verdict", () => {
    const v = extractVerdictJson(`{"is_highlight": true, "keep_prob": 0.82, "what_happened": "Boat heist escape", "score": 8, "adjusted_cut_start_sec": 18680, "adjusted_cut_end_sec": 18710, "flags": []}`);
    expect(v?.isHighlight).toBe(true);
    expect(v?.keepProb).toBe(0.82);
    expect(v?.whatHappened).toBe("Boat heist escape");
    expect(v?.flags).toEqual([]);
  });

  test("extracts JSON embedded in surrounding prose / thinking text", () => {
    const v = extractVerdictJson(`Let me assess... here it is:\n{"is_highlight": false, "keep_prob": 0.1, "what_happened": "unclear", "score": 2, "adjusted_cut_start_sec": 10, "adjusted_cut_end_sec": 40, "flags": ["chat_sparse"]}\ndone`);
    expect(v?.isHighlight).toBe(false);
    expect(v?.flags).toEqual(["chat_sparse"]);
  });

  test("malformed JSON → null (caller records judge_error, never a rejection)", () => {
    expect(extractVerdictJson(`{"is_highlight": tru, oops`)).toBeNull();
    expect(extractVerdictJson(`no braces at all`)).toBeNull();
    expect(extractVerdictJson(`{"is_highlight": "maybe"}`)?.isHighlight).toBeNull();
  });

  test("non-numeric fields degrade to null, not NaN", () => {
    const v = extractVerdictJson(`{"is_highlight": true, "keep_prob": "high", "score": null}`);
    expect(v?.keepProb).toBeNull();
    expect(v?.score).toBeNull();
  });
});
