# vodclip

Cut a timestamped clip from a **Twitch** or **Kick** VOD in one command. No account, no login, minimal deps — it drives `yt-dlp` for you.

```bash
npx vodclip@latest <url> [start] [duration]
```

## Examples

```bash
# 2-minute clip starting at 9h25m19s (timestamp from ?t= is picked up automatically)
npx vodclip@latest "https://www.twitch.tv/videos/2883843627?t=09h25m19s"

# explicit start + 45s duration
npx vodclip@latest "https://www.twitch.tv/videos/2883843627" 09:25:19 45

# Kick VOD, start at 1h2m3s, 90 seconds
npx vodclip@latest "https://kick.com/video/some-uuid" 1h2m3s 90

# no args → interactive form (URL, start, duration)
npx vodclip@latest
```

Twitch clip / Kick clip URLs download the whole clip — no timestamps needed.

## Input formats

| Field     | Accepted                                    |
|-----------|---------------------------------------------|
| start     | `09h25m19s`, `09:25:19`, `5559` (seconds), `?t=` in URL |
| duration  | whole seconds (default `120`)               |

## Output

`<platform>_<vod-id>_<HHMMSS>.mp4` in the current directory, cut on keyframes (`--force-keyframes-at-cuts`) so the clip starts clean.

## Requirements

- [Node.js](https://nodejs.org) ≥ 18
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) on PATH:
  - Windows: `winget install yt-dlp.yt-dlp`
  - macOS: `brew install yt-dlp`
  - Linux: `pipx install yt-dlp`
- Kick VODs sit behind Cloudflare; if yt-dlp's automatic impersonation fails: `pip install -U "yt-dlp[default,curl-cffi]"`

## Notes

- Public VODs only — sub-only VODs require platform auth, which this tool intentionally does not handle.
- Long start timestamps are inherently slow: yt-dlp must stream from the VOD's beginning to your cut point. That's normal, let it run.

## License

MIT
