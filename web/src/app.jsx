import { useMemo, useState } from "react";
import { parseStart, fmt, classify } from "../../lib.mjs";
import { Card, CardContent } from "./components/card";
import { Button } from "./components/button";
import { Input } from "./components/input";
import { Badge } from "./components/badge";
import { RollText } from "./components/roll-text";
import { Copy, Check, Github, Link2, Scissors } from "lucide-react";

export default function App() {
  // deep-link support: ?u=<vod url>&t=<start>&d=<duration>
  const params = new URLSearchParams(location.search);
  const [url, setUrl] = useState(params.get("u") ?? "");
  const [start, setStart] = useState(params.get("t") ?? "");
  const [duration, setDuration] = useState(params.get("d") ?? "120");
  const [copied, setCopied] = useState(false);

  const parsed = useMemo(() => classify(url.trim()), [url]);
  const invalid = url.trim().length > 0 && !parsed;

  const startSec = useMemo(() => {
    if (!parsed || parsed.kind === "clip") return 0;
    const raw = start || parsed.t || "0";
    return parseStart(raw);
  }, [parsed, start]);

  const durSec = useMemo(() => {
    const n = +duration;
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [duration]);

  const command = useMemo(() => {
    if (!parsed) return null;
    if (parsed.kind === "clip") return `npx vodclip@latest "${url.trim()}"`;
    if (Number.isNaN(startSec) || durSec == null) return null;
    return `npx vodclip@latest "${url.trim()}" ${fmt(startSec).replace(/^00:/, "")} ${durSec}`;
  }, [parsed, url, startSec, durSec]);

  // the cut, drawn on a vod-length track: where the clip window lands
  const track = useMemo(() => {
    if (!parsed || parsed.kind !== "vod" || Number.isNaN(startSec) || durSec == null || startSec < 0) return null;
    const end = startSec + durSec;
    const total = Math.max(end + Math.max(durSec, 30), 900);
    return {
      end,
      total,
      left: Math.min((startSec / total) * 100, 98),
      width: Math.max((durSec / total) * 100, 1.5),
    };
  }, [parsed, startSec, durSec]);

  async function copy() {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="app min-h-dvh bg-bg text-fg" data-platform={parsed?.platform ?? "none"}>
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 pt-8">
        <a href="#" className="flex items-center gap-2.5 font-mono text-sm font-semibold tracking-tight">
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className="text-accent">
            <rect x="1" y="4" width="18" height="12" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <line x1="5" y1="4" x2="5" y2="16" stroke="currentColor" strokeWidth="1.5" />
            <line x1="9" y1="4" x2="9" y2="16" stroke="currentColor" strokeWidth="1.5" />
            <rect x="11.5" y="7" width="5.5" height="6" rx="1" fill="currentColor" />
          </svg>
          vodclip
        </a>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-2 font-mono text-xs"
          onClick={() => location.href = "https://github.com/katsugtgz/vodclip"}
        >
          <Github className="size-3.5" />
          github
        </Button>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-12 px-6 pb-24 pt-16 sm:pt-24">
        <section className="reveal">
          <h1 className="display max-w-[16ch] text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
            cut the moment out of the vod.
          </h1>
          <p className="mt-5 max-w-[52ch] text-pretty text-base leading-relaxed text-muted">
            paste a twitch or kick link, set the in and out points, copy one command.
            yt-dlp does the cutting — no account, no upload, no tracking.
          </p>
        </section>

        <Card className="reveal" style={{ animationDelay: "90ms" }}>
          <CardContent className="flex flex-col gap-5">
            <div className="relative">
              <Link2 className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <Input
                placeholder="https://www.twitch.tv/videos/2883843627?t=09h25m19s"
                className={`pl-11 pr-28 font-mono text-sm ${invalid ? "animate-shake border-red-500/60" : ""}`}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                spellCheck={false}
                autoFocus
              />
              {parsed && (
                <Badge className="absolute right-3 top-1/2 -translate-y-1/2 border-accent/40 bg-card font-mono text-accent">
                  {parsed.platform} {parsed.kind}
                </Badge>
              )}
            </div>
            {invalid && (
              <p className="reveal font-mono text-xs text-red-400">
                not a twitch or kick link. paste a vod or clip url from either platform.
              </p>
            )}

            {parsed && parsed.kind === "vod" && (
              <div className="reveal-stagger grid grid-cols-2 gap-3">
                <label className="field flex flex-col gap-2">
                  <span className="field-label font-mono text-[11px] uppercase tracking-wider text-muted">start</span>
                  <Input
                    className="font-mono text-sm"
                    placeholder={parsed.t ?? "0:00:00"}
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                    spellCheck={false}
                  />
                </label>
                <label className="field flex flex-col gap-2">
                  <span className="field-label font-mono text-[11px] uppercase tracking-wider text-muted">duration (seconds)</span>
                  <Input
                    className="font-mono text-sm"
                    inputMode="numeric"
                    value={duration}
                    onChange={(e) => setDuration(e.target.value.replace(/\D/g, ""))}
                  />
                </label>
              </div>
            )}

            {track && (
              <div className="reveal-stagger flex flex-col gap-2">
                <div className="track" aria-hidden="true">
                  <div className="clip-win" style={{ left: `${track.left}%`, width: `${track.width}%` }} />
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 font-mono text-[11px] text-muted">
                  <span>
                    in <span className="text-fg">{fmt(startSec)}</span>
                    {" "}out <RollText value={fmt(track.end)} className="text-accent" />
                  </span>
                  <span>cut window · {durSec}s of a {fmt(track.total).replace(/^00:/, "")} vod</span>
                </div>
              </div>
            )}

            {command && (
              <div className="reveal flex flex-col gap-3">
                <div className="flex items-center justify-between font-mono text-xs text-muted">
                  <span className="flex items-center gap-1.5">
                    <Scissors className="size-3 text-accent" />
                    {parsed.kind === "clip" ? "full clip — timestamps ignored" : "the command"}
                  </span>
                  {parsed.kind === "vod" && <span>{durSec}s</span>}
                </div>
                <div className="flex items-center gap-2 rounded-xl border border-accent/30 bg-black/50 p-1 pl-4">
                  <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap py-2.5 font-mono text-[13px] text-fg/90">
                    {command}
                  </code>
                  <Button size="icon" className="text-[color:var(--on-accent)]" onClick={copy} aria-label="copy command">
                    {copied ? <Check /> : <Copy />}
                  </Button>
                </div>
                <p className="font-mono text-[11px] leading-relaxed text-muted">
                  needs <a className="text-accent underline decoration-accent/40 underline-offset-2" href="https://github.com/yt-dlp/yt-dlp#installation" target="_blank" rel="noreferrer">yt-dlp</a> on your path. public vods only, no login.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <ol className="steps reveal">
          <li><span className="text-accent">01</span> paste the vod link</li>
          <li><span className="text-accent">02</span> set start + length</li>
          <li><span className="text-accent">03</span> run the command</li>
        </ol>
      </main>

      <footer className="mx-auto flex max-w-3xl items-center justify-between px-6 pb-8 font-mono text-[11px] text-muted">
        <span>no account · no tracking · open source</span>
        <a className="transition-colors hover:text-fg" href="https://github.com/katsugtgz/vodclip" target="_blank" rel="noreferrer">
          MIT licensed
        </a>
      </footer>
    </div>
  );
}
