# vodclip

Cut a clip from a Twitch or Kick VOD at a start timestamp. One command runs yt-dlp with the correct options. Public VODs need no account.

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

Twitch clip and Kick clip URLs download the full clip. The tool ignores timestamps for clips.

## Input formats

| Field    | Accepted                                                |
|----------|----------------------------------------------------------|
| start    | `09h25m19s`, `09:25:19`, `5559` (seconds), `?t=` in URL |
| duration | whole seconds (default `120`)                           |

## Output

The tool writes `<platform>_<vod-id>_<HHMMSS>.mp4` to the current directory. It sets `--force-keyframes-at-cuts`, so the clip starts on a keyframe.

## Requirements

- [Node.js](https://nodejs.org) 18 or later
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) on PATH:
  - Windows: `winget install yt-dlp.yt-dlp`
  - macOS: `brew install yt-dlp`
  - Linux: `pipx install yt-dlp`
- Kick VODs sit behind Cloudflare. yt-dlp impersonates a browser automatically. If that fails, install the impersonation extras: `pip install -U "yt-dlp[default,curl-cffi]"`

## Notes

- vodclip supports public VODs only. Sub-only VODs need a platform login, and the tool does not handle logins.
- A large start timestamp makes the download slow. yt-dlp streams from the start of the VOD to your cut point. Wait for the download to finish.

## License

MIT
