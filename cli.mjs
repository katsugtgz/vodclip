#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import * as p from "@clack/prompts";
import { parseStart, fmt, classify } from "./lib.mjs";

// ---------- system probe ----------

let ytDlpPath = "yt-dlp";

const EXTRA_PATHS = process.platform === "win32"
  ? [
      `${process.env.LOCALAPPDATA}\\Microsoft\\WinGet\\Links\\yt-dlp.exe`,
      `${process.env.USERPROFILE}\\scoop\\shims\\yt-dlp.exe`,
    ]
  : [
      `${process.env.HOME}/.local/bin/yt-dlp`,
      `${process.env.HOME}/.local/pipx/venvs/yt-dlp/bin/yt-dlp`,
      "/opt/homebrew/bin/yt-dlp",
      "/usr/local/bin/yt-dlp",
    ];

function hasCmd(cmd) {
  const finder = process.platform === "win32" ? "where" : "which";
  return spawnSync(finder, [cmd], { shell: process.platform === "win32" }).status === 0;
}

function fsExists(p) {
  return spawnSync("node", ["-e", `require("fs").accessSync(${JSON.stringify(p)})`]).status === 0;
}

function probeYtDlp() {
  if (hasCmd("yt-dlp")) { ytDlpPath = "yt-dlp"; return true; }
  for (const candidate of EXTRA_PATHS) {
    if (candidate && fsExists(candidate)) { ytDlpPath = candidate; return true; }
  }
  return false;
}

// installers that can fetch yt-dlp (and ffmpeg), per platform
const INSTALLERS = [
  { name: "winget", on: ["win32"], ytDlp: ["winget", "install", "-e", "--id", "yt-dlp.yt-dlp", "--accept-source-agreements", "--accept-package-agreements"], ffmpeg: ["winget", "install", "-e", "--id", "Gyan.FFmpeg", "--accept-source-agreements", "--accept-package-agreements"] },
  { name: "brew", on: ["darwin"], ytDlp: ["brew", "install", "yt-dlp"], ffmpeg: ["brew", "install", "ffmpeg"] },
  { name: "scoop", on: ["win32"], ytDlp: ["scoop", "install", "yt-dlp"], ffmpeg: ["scoop", "install", "ffmpeg"] },
  { name: "choco", on: ["win32"], ytDlp: ["choco", "install", "yt-dlp", "-y"], ffmpeg: ["choco", "install", "ffmpeg", "-y"] },
  { name: "pipx", on: ["win32", "darwin", "linux"], ytDlp: ["pipx", "install", "yt-dlp"] },
  { name: "uv", on: ["win32", "darwin", "linux"], ytDlp: ["uv", "tool", "install", "yt-dlp"] },
  { name: "apt", on: ["linux"], ffmpegOnly: true, ffmpeg: ["sudo", "apt-get", "install", "-y", "ffmpeg"] },
];

const FFMPEG_HINTS = {
  win32: "winget install -e --id Gyan.FFmpeg",
  darwin: "brew install ffmpeg",
  linux: "sudo apt-get install ffmpeg   (or your distro's package manager)",
};

function detectedInstallers() {
  return INSTALLERS.filter((i) => i.on.includes(process.platform) && hasCmd(i.name));
}

function runInstaller(inst, what) {
  const cmd = what === "ffmpeg" ? inst.ffmpeg : inst.ytDlp;
  if (!cmd) return false;
  p.log.step(`running: ${cmd.join(" ")}`);
  const r = spawnSync(cmd[0], cmd.slice(1), { stdio: "inherit", shell: process.platform === "win32" });
  return r.status === 0;
}

const MANUAL = {
  win32: ["winget install -e --id yt-dlp.yt-dlp", "scoop install yt-dlp", "choco install yt-dlp -y", "pip install -U yt-dlp"],
  darwin: ["brew install yt-dlp", "pipx install yt-dlp"],
  linux: ["pipx install yt-dlp", "uv tool install yt-dlp", "pip install --user yt-dlp"],
};

async function ensureYtDlp() {
  if (probeYtDlp()) return true;

  p.log.warning("yt-dlp is not installed. vodclip needs it to download video.");

  const installers = detectedInstallers();
  if (!process.stdin.isTTY) {
    // no terminal attached: prompting would hang forever
    for (const line of MANUAL[process.platform] ?? []) p.log.info(`  ${line}`);
    p.log.info("then re-run vodclip. docs: https://github.com/yt-dlp/yt-dlp#installation");
    return false;
  }

  const options = [
    ...installers.map((i) => ({ value: i.name, label: `install now with ${i.name}` })),
    { value: "manual", label: "show manual install steps (I'll do it myself)" },
    { value: "skip", label: "exit without installing" },
  ];

  const choice = await p.select({ message: "install yt-dlp now?", options, initialValue: installers[0]?.name ?? "manual" });
  if (p.isCancel(choice) || choice === "skip") return false;

  if (choice === "manual") {
    for (const line of MANUAL[process.platform] ?? []) p.log.info(`  ${line}`);
    p.log.info("then re-run vodclip. docs: https://github.com/yt-dlp/yt-dlp#installation");
    return false;
  }

  const inst = installers.find((i) => i.name === choice);
  const ok = runInstaller(inst, "yt-dlp");
  if (!ok || !probeYtDlp()) {
    p.log.error("install did not complete. try a manual method:");
    for (const line of MANUAL[process.platform] ?? []) p.log.info(`  ${line}`);
    return false;
  }

  // a fresh winget/scoop install lands on PATH only for new processes; we
  // already probed known locations, so this session can continue.
  p.log.success(`yt-dlp installed (${ytDlpPath})`);
  p.log.info("note: open a new terminal if other tools can't see yt-dlp yet.");
  return true;
}

async function ensureFfmpeg() {
  if (hasCmd("ffmpeg")) return true;

  if (!process.stdin.isTTY) {
    p.log.warning(`ffmpeg is missing and is required to cut at exact timestamps. install it: ${FFMPEG_HINTS[process.platform]}`);
    return;
  }

  const installers = detectedInstallers().filter((i) => i.ffmpeg);
  const choice = await p.select({
    message: "ffmpeg is missing. it is required to cut at exact timestamps. install it now?",
    options: [
      ...installers.map((i) => ({ value: i.name, label: `install ffmpeg now with ${i.name}` })),
      { value: "manual", label: "show manual steps" },
      { value: "skip", label: "continue anyway (download will likely fail)" },
    ],
    initialValue: installers[0]?.name ?? "manual",
  });
  if (p.isCancel(choice) || choice === "skip") {
    p.log.warning("proceeding without ffmpeg. expect the cut to fail.");
    return;
  }
  if (choice === "manual") {
    p.log.info(`  ${FFMPEG_HINTS[process.platform]}`);
    p.log.warning("install ffmpeg, then re-run vodclip.");
    process.exit(1);
  }
  const inst = installers.find((i) => i.name === choice);
  const ok = runInstaller(inst, "ffmpeg");
  if (!ok || !hasCmd("ffmpeg")) {
    p.log.error("ffmpeg install did not complete. manual step:");
    p.log.info(`  ${FFMPEG_HINTS[process.platform]}`);
    p.log.warning("vodclip needs ffmpeg for --force-keyframes-at-cuts.");
    process.exit(1);
  }
  p.log.success("ffmpeg installed");
}

// ---------- main ----------

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const noInstall = args.includes("--no-install");
const positional = args.filter((a) => a !== "--dry-run" && a !== "--no-install");

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

const ytArgs = ["--force-keyframes-at-cuts", "-o", outName, info.url];
if (!isClip) {
  ytArgs.unshift(`--download-sections "*${fmt(info.start)}-${fmt(end)}"`);
}

p.log.step(`${info.platform} ${info.kind} ${info.id}` + (isClip ? "" : ` | ${fmt(info.start)} → ${fmt(end)} (${info.duration}s)`));

if (dryRun) {
  p.log.info(`[dry run] yt-dlp ${ytArgs.join(" ")}`);
  p.outro("Dry run complete. No file downloaded.");
  process.exit(0);
}

if (!noInstall) {
  if (!(await ensureYtDlp())) {
    p.cancel("Cannot continue without yt-dlp.");
    process.exit(1);
  }
} else if (!probeYtDlp()) {
  p.cancel("yt-dlp not found and --no-install was set.");
  process.exit(1);
}
await ensureFfmpeg();

const t0 = Date.now();
const r = spawnSync(ytDlpPath, ytArgs, { stdio: "inherit", shell: process.platform === "win32" });

if (r.status !== 0) {
  p.log.error(`yt-dlp exited with code ${r.status}. Common causes: private/deleted VOD, sub-only VOD (needs auth), or Cloudflare block on Kick (fix: pip install -U "yt-dlp[default,curl-cffi]").`);
  process.exit(r.status ?? 1);
}

p.outro(`Done in ${((Date.now() - t0) / 1000).toFixed(0)}s → ${outName.replace("%(ext)s", "mp4")}`);
