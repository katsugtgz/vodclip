import { useMemo, useState } from "react";
import { parseStart, fmt, classify } from "../../lib.mjs";
import { Card, CardContent } from "./components/card";
import { Button } from "./components/button";
import { Input } from "./components/input";
import { Badge } from "./components/badge";
import { RollText } from "./components/roll-text";
import { Copy, Check, Github, Terminal, Link2, LoaderCircle } from "lucide-react";

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

  const endStr = useMemo(
    () => (parsed && parsed.kind === "vod" && durSec != null && !Number.isNaN(startSec) ? fmt(startSec + durSec) : null),
    [parsed, startSec, durSec]
  );

  async function copy() {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="mx-auto flex max-w-2xl items-center justify-between px-6 pt-8">
        <a href="#" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Terminal className="size-4 text-accent" />
          vodclip
        </a>
        <Button variant="ghost" size="sm" className="h-8 gap-2 text-xs" onClick={() => location.href = "https://github.com/katsugtgz/vodclip"}>
          <Github className="size-3.5" />
          github
        </Button>
      </header>

      <main className="mx-auto flex max-w-2xl flex-col gap-10 px-6 pb-24 pt-20 sm:pt-28">
        <section className="reveal text-center">
          <h1 className="text-balance text-4xl font-semibold tracking-tighter sm:text-5xl">
            cut a clip from any twitch or kick vod.
          </h1>
          <p className="mx-auto mt-4 max-w-md text-balance text-base text-muted">
            paste a link. tune the cut. copy the command. run it in your terminal, done.
          </p>
        </section>

        <Card className="reveal" style={{ animationDelay: "90ms" }}>
          <CardContent className="flex flex-col gap-5">
            <div className="relative">
              <Link2 className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <Input
                placeholder="https://www.twitch.tv/videos/2883843627?t=09h25m19s"
                className={`pl-11 pr-28 ${invalid ? "animate-shake border-red-500/60" : ""}`}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                spellCheck={false}
                autoFocus
              />
              {parsed && (
                <Badge className="absolute right-3 top-1/2 -translate-y-1/2 border-accent/30 bg-accent/10 text-accent">
                  {parsed.platform} {parsed.kind}
                </Badge>
              )}
            </div>
            {invalid && (
              <p className="reveal text-xs text-red-400">
                not a twitch or kick link. paste a vod or clip url from either platform.
              </p>
            )}

            {parsed && parsed.kind === "vod" && (
              <div className="reveal-stagger grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-2">
                  <span className="text-xs text-muted">start</span>
                  <Input
                    placeholder={parsed.t ?? "0:00:00"}
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                    spellCheck={false}
                  />
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-xs text-muted">duration (seconds)</span>
                  <Input
                    inputMode="numeric"
                    value={duration}
                    onChange={(e) => setDuration(e.target.value.replace(/\D/g, ""))}
                  />
                </label>
              </div>
            )}

            {command && (
              <div className="reveal flex flex-col gap-3">
                <div className="flex items-center justify-between text-xs text-muted">
                  <span className="flex items-center gap-1.5">
                    <LoaderCircle className="size-3" />
                    {parsed.kind === "clip"
                      ? "full clip, no timestamps needed"
                      : <>
                          cut {fmt(startSec)} <span aria-hidden>→</span>{" "}
                          <RollText value={endStr} className="font-mono text-accent" />
                        </>
                    }
                  </span>
                  {parsed.kind === "vod" && <span className="font-mono">{durSec}s</span>}
                </div>
                <div className="flex items-center gap-2 rounded-xl border border-line bg-black/40 p-1 pl-4">
                  <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap py-2.5 font-mono text-[13px] text-fg/90">
                    {command}
                  </code>
                  <Button size="icon" onClick={copy} aria-label="copy command">
                    {copied ? <Check className="text-white" /> : <Copy />}
                  </Button>
                </div>
                <p className="text-xs text-muted">
                  needs <a className="text-accent underline decoration-accent/40 underline-offset-2" href="https://github.com/yt-dlp/yt-dlp#installation" target="_blank" rel="noreferrer">yt-dlp</a> on your path. public vods only, no login.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <section className="reveal grid grid-cols-3 gap-3 text-center text-xs text-muted" style={{ animationDelay: "180ms" }}>
          <div className="rounded-2xl border border-line bg-card px-3 py-4">
            <div className="font-semibold text-fg">1</div>
            paste the vod link
          </div>
          <div className="rounded-2xl border border-line bg-card px-3 py-4">
            <div className="font-semibold text-fg">2</div>
            set start + length
          </div>
          <div className="rounded-2xl border border-line bg-card px-3 py-4">
            <div className="font-semibold text-fg">3</div>
            run the command
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-2xl items-center justify-between px-6 pb-8 text-xs text-muted">
        <span>no account · no tracking · open source</span>
        <a className="transition-colors hover:text-fg" href="https://github.com/katsugtgz/vodclip" target="_blank" rel="noreferrer">
          MIT licensed
        </a>
      </footer>
    </div>
  );
}
