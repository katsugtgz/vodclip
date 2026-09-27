import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStart, fmt, classify } from "../lib.mjs";

test("parseStart: h/m/s letters", () => {
  assert.equal(parseStart("09h25m19s"), 33919);
  assert.equal(parseStart("1h2m3s"), 3723);
  assert.equal(parseStart("45m"), 2700);
  assert.equal(parseStart("30s"), 30);
});

test("parseStart: h:m:s", () => {
  assert.equal(parseStart("09:25:19"), 33919);
  assert.equal(parseStart("2:05"), 125);
  assert.equal(parseStart("1:00:00"), 3600);
});

test("parseStart: plain seconds", () => {
  assert.equal(parseStart("5559"), 5559);
  assert.equal(parseStart("0"), 0);
});

test("parseStart: empty and invalid", () => {
  assert.equal(parseStart(""), 0);
  assert.equal(parseStart(null), 0);
  assert.equal(parseStart(undefined), 0);
  assert.equal(parseStart("abc"), null);
});

test("fmt: zero-padded h:m:s", () => {
  assert.equal(fmt(0), "00:00:00");
  assert.equal(fmt(33919), "09:25:19");
  assert.equal(fmt(3723), "01:02:03");
  assert.equal(fmt(3600), "01:00:00");
  assert.equal(fmt(-5), "00:00:00");
});

test("fmt: fractional seconds floor", () => {
  assert.equal(fmt(125.9), "00:02:05");
});

test("classify: twitch vod with ?t", () => {
  const c = classify("https://www.twitch.tv/videos/2883843627?t=09h25m19s");
  const { url, ...rest } = c;
  assert.deepEqual(rest, { platform: "twitch", id: "2883843627", kind: "vod", t: "09h25m19s" });
});

test("classify: twitch vod no timestamp", () => {
  const c = classify("https://www.twitch.tv/videos/123");
  assert.equal(c.platform, "twitch");
  assert.equal(c.kind, "vod");
  assert.equal(c.t, null);
});

test("classify: twitch clip forms", () => {
  assert.equal(classify("https://www.twitch.tv/someuser/clip/FunnyClip-abc123").kind, "clip");
  assert.equal(classify("https://www.twitch.tv/clips/FunnyClip-abc123").kind, "clip");
});

test("classify: kick vod forms", () => {
  assert.equal(classify("https://kick.com/video/some-uuid-123").kind, "vod");
  assert.equal(classify("https://kick.com/somestreamer/videos/some-uuid-123").kind, "vod");
});

test("classify: kick clip", () => {
  assert.equal(classify("https://kick.com/clips/clip-uuid").kind, "clip");
  assert.equal(classify("https://kick.com/clip/clip-uuid").kind, "clip");
});

test("classify: rejects non-platform urls", () => {
  assert.equal(classify("https://youtube.com/watch?v=x"), null);
  assert.equal(classify("https://twitch.tv/directory"), null);
  assert.equal(classify("not a url"), null);
});

test("classify: subdomain stripped", () => {
  assert.equal(classify("https://m.twitch.tv/videos/99").id, "99");
});
