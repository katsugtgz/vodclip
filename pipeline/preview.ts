// Pre-cut rough previews + final 9:16 renders (amendment #3: the founder
// never labels a crop he cannot see; previews are pre-cut, nudge = re-cut).
// Reuses yt-dlp (vodclip's existing downloader) with --download-sections.

import { $ } from "bun";

export async function fetchSection(
  vodUrl: string,
  startSec: number,
  endSec: number,
  outPath: string,
): Promise<{ ok: boolean; detail: string }> {
  const dur = Math.max(5, endSec - startSec);
  const proc = Bun.spawn([
    "yt-dlp",
    "--download-sections", `*${Math.max(0, startSec - 2)}-${endSec + 2}`,
    "--force-keyframes-at-cuts",
    "-f", "best[height<=1080]/best",
    "-o", outPath,
    "--no-playlist",
    vodUrl,
  ], { stdout: "pipe", stderr: "pipe" });
  const [code] = await Promise.all([proc.exited]);
  const err = await new Response(proc.stderr).text();
  if (code !== 0) return { ok: false, detail: err.slice(-500) };
  return { ok: true, detail: `section ${startSec}-${endSec}s → ${outPath}` };
}

/** 9:16 center-crop from a section file (final render). */
export async function render916(srcPath: string, outPath: string): Promise<{ ok: boolean; detail: string }> {
  const proc = Bun.spawn([
    "ffmpeg", "-y", "-i", srcPath,
    "-vf", "crop=ih*9/16:ih,scale=1080:1920,fps=30",
    "-c:v", "libx264", "-preset", "fast", "-crf", "23",
    "-c:a", "aac", "-b:a", "128k",
    "-movflags", "+faststart",
    outPath,
  ], { stdout: "pipe", stderr: "pipe" });
  const code = await proc.exited;
  const err = await new Response(proc.stderr).text();
  if (code !== 0) return { ok: false, detail: err.slice(-500) };
  return { ok: true, detail: outPath };
}

export async function ffmpegThumb(srcPath: string, outPath: string, atSec = 1): Promise<boolean> {
  const proc = Bun.spawn([
    "ffmpeg", "-y", "-ss", String(atSec), "-i", srcPath, "-frames:v", "1", "-vf", "scale=360:-2", outPath,
  ], { stdout: "pipe", stderr: "pipe" });
  return (await proc.exited) === 0;
}
