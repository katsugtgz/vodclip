#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import * as p from "@clack/prompts";
import { parseStart, fmt, classify } from "./lib.mjs";

function hasYtDlp() {
  const cmd = process.platform === "win32" ? "where" : "which";
  return spawnSync(cmd, ["yt-dlp"], { shell: process.platform === "win32" }).status === 0;
}

// ---------- main ----------

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const positional = args.filter((a) => a !== "--dry-run");

p.intro("vodclip — cut a clip from a Twitch or Kick VOD");

const info = await (async () => {
  // interactive mode when no URL arg
  if (positional.length === 0 || !/^https?:\/\//.test(positional[0])) {
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
  const url = positional[0];
  const c = classify(url);
  if (!c) { p.log.error("Unrecognized Twitch/Kick URL"); return null; }
  if (c.kind === "clip") return { ...c, start: 0, duration: null };

  const startRaw = c.t ?? positional[1];
  const start = parseStart(startRaw ?? "0");
  if (start == null) { p.log.error(`Bad start timestamp: ${startRaw}`); return null; }
  const duration = positional[2] ? +positional[2] : 120;
  if (!Number.isFinite(duration) || duration <= 0) { p.log.error("Duration must be positive seconds"); return null; }
  return { ...c, start, duration };
})();

if (!info) { p.cancel("Aborted"); process.exit(1); }

const isClip = info.kind === "clip";
const end = isClip ? null : info.start + info.duration;
const outName = isClip
  ? `${info.platform}_clip_${info.id}.%(ext)s`
  : `${info.platform}_${info.id}_${fmt(info.start).replace(/:/g, "")}.%(ext)s`;

const ytArgs = ["--force-keyframes-at-cuts", "-o", outName];
if (!isClip) {
  ytArgs.unshift(`--download-sections "*${fmt(info.start)}-${fmt(end)}"`);
}

p.log.step(`${info.platform} ${info.kind} ${info.id}` + (isClip ? "" : ` | ${fmt(info.start)} → ${fmt(end)} (${info.duration}s)`));

if (dryRun) {
  p.log.info(`[dry run] yt-dlp ${ytArgs.join(" ")}`);
  p.outro("Dry run complete. No file downloaded.");
  process.exit(0);
}

if (!hasYtDlp()) {
  p.log.error("yt-dlp not found on PATH. Install it first:");
  p.log.info("  Windows : winget install yt-dlp.yt-dlp   (or: pip install -U yt-dlp)");
  p.log.info("  macOS   : brew install yt-dlp");
  p.log.info("  Linux   : pipx install yt-dlp");
  process.exit(1);
}

const t0 = Date.now();
const r = spawnSync("yt-dlp", ytArgs, { stdio: "inherit", shell: process.platform === "win32" });

if (r.status !== 0) {
  p.log.error(`yt-dlp exited with code ${r.status}. Common causes: private/deleted VOD, sub-only VOD (needs auth), or Cloudflare block on Kick (fix: pip install -U "yt-dlp[default,curl-cffi]").`);
  process.exit(r.status ?? 1);
}

p.outro(`Done in ${((Date.now() - t0) / 1000).toFixed(0)}s → ${outName.replace("%(ext)s", "mp4")}`);
