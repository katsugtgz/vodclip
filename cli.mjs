#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import * as p from "@clack/prompts";

// ---------- timestamp helpers ----------

function parseStart(raw) {
  if (raw == null || raw === "") return 0;
  const s = String(raw).trim().toLowerCase();
  // strip URL query prefix if user pasted whole ?t=
  const m = s.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
  const hms = s.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})$/);
  if (hms) return (+hms[1] || 0) * 3600 + +hms[2] * 60 + +hms[3];
  const t = s.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (t && (t[1] || t[2] || t[3])) {
    return (+t[1] || 0) * 3600 + (+t[2] || 0) * 60 + +t[3];
  }
  if (/^\d+$/.test(s)) return +s;
  return null;
}

function fmt(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// ---------- url helpers ----------

function classify(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^www\./, "");

  if (host === "twitch.tv" || host.endsWith(".twitch.tv")) {
    const vod = u.pathname.match(/^\/videos\/(\d+)/);
    const clip = u.pathname.match(/^\/[^/]+\/clip\/([\w-]+)/) || u.pathname.match(/^\/clip\/([\w-]+)/);
    if (clip) return { platform: "twitch", id: clip[1], kind: "clip", url };
    if (vod) return { platform: "twitch", id: vod[1], kind: "vod", url, t: u.searchParams.get("t") };
    return null;
  }
  if (host === "kick.com") {
    const vod = u.pathname.match(/^\/video\/([\w-]+)/) || u.pathname.match(/^\/[^/]+\/videos\/([\w-]+)/);
    const clip = u.pathname.match(/^\/clips?\/([\w-]+)/);
    if (clip) return { platform: "kick", id: clip[1], kind: "clip", url };
    if (vod) return { platform: "kick", id: vod[1], kind: "vod", url, t: u.searchParams.get("t") };
    return null;
  }
  return null;
}

function hasYtDlp() {
  const cmd = process.platform === "win32" ? "where" : "which";
  return spawnSync(cmd, ["yt-dlp"], { shell: process.platform === "win32" }).status === 0;
}

// ---------- main ----------

const args = process.argv.slice(2);

p.intro("vodclip — cut a clip from a Twitch or Kick VOD");

const info = await (async () => {
  // interactive mode when no URL arg
  if (args.length === 0 || !/^https?:\/\//.test(args[0])) {
    const url = await p.text({
      message: "VOD URL",
      placeholder: "https://www.twitch.tv/videos/123456789 or https://kick.com/video/xxxx",
      validate: (v) => {
        if (!/^https?:\/\//.test(v)) return "Must start with http(s)://";
        if (!classify(v)) return "Not a recognized Twitch/Kick VOD or clip URL";
      },
    });
    if (p.isCancel(url)) return null;
    const c = classify(url);
    let start, duration;
    if (c.kind === "clip") {
      start = 0; duration = null;
    } else {
      const sRaw = await p.text({
        message: "Start timestamp (h:m:s, 1h2m3s, or seconds)",
        placeholder: c.t ? `${c.t} (from URL)` : "0:00:00",
        initialValue: c.t ?? "",
      });
      if (p.isCancel(sRaw)) return null;
      start = parseStart(sRaw || c.t || "0");
      if (start == null) { p.log.error("Bad timestamp"); return null; }
      const dRaw = await p.text({
        message: "Duration in seconds",
        placeholder: "120",
        initialValue: "120",
        validate: (v) => (/^\d+$/.test(v) ? undefined : "Whole seconds only"),
      });
      if (p.isCancel(dRaw)) return null;
      duration = +dRaw;
    }
    return { ...c, start, duration };
  }

  // CLI mode: npx vodclip <url> [start] [duration]
  const url = args[0];
  const c = classify(url);
  if (!c) { p.log.error("Unrecognized Twitch/Kick URL"); return null; }
  if (c.kind === "clip") return { ...c, start: 0, duration: null };

  const startRaw = c.t ?? args[1];
  const start = parseStart(startRaw ?? "0");
  if (start == null) { p.log.error(`Bad start timestamp: ${startRaw}`); return null; }
  const duration = args[2] ? +args[2] : 120;
  if (!Number.isFinite(duration) || duration <= 0) { p.log.error("Duration must be positive seconds"); return null; }
  return { ...c, start, duration };
})();

if (!info) { p.cancel("Aborted"); process.exit(1); }

if (!hasYtDlp()) {
  p.log.error("yt-dlp not found on PATH. Install it first:");
  p.log.info("  Windows : winget install yt-dlp.yt-dlp   (or: pip install -U yt-dlp)");
  p.log.info("  macOS   : brew install yt-dlp");
  p.log.info("  Linux   : pipx install yt-dlp");
  process.exit(1);
}

const isClip = info.kind === "clip";
const end = isClip ? null : info.start + info.duration;
const outName = isClip
  ? `${info.platform}_clip_${info.id}.%(ext)s`
  : `${info.platform}_${info.id}_${fmt(info.start).replace(/:/g, "")}.%(ext)s`;

const ytArgs = ["--force-keyframes-at-cuts", "-o", outName, info.url];
if (!isClip) {
  ytArgs.unshift(`--download-sections "*${fmt(info.start)}-${fmt(end)}"`);
}

p.log.step(`${info.platform} ${info.kind} ${info.id}` + (isClip ? "" : ` | ${fmt(info.start)} → ${fmt(end)} (${info.duration}s)`));

const t0 = Date.now();
const r = spawnSync("yt-dlp", ytArgs, { stdio: "inherit", shell: process.platform === "win32" });

if (r.status !== 0) {
  p.log.error(`yt-dlp exited with code ${r.status}. Common causes: private/deleted VOD, sub-only VOD (needs auth), or Cloudflare block on Kick (fix: pip install -U "yt-dlp[default,curl-cffi]").`);
  process.exit(r.status ?? 1);
}

p.outro(`Done in ${((Date.now() - t0) / 1000).toFixed(0)}s → ${outName.replace("%(ext)s", "mp4")}`);
