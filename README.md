# vodclip

[![CI](https://github.com/katsugtgz/vodclip/actions/workflows/ci.yml/badge.svg)](https://github.com/katsugtgz/vodclip/actions/workflows/ci.yml)

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

yt-dlp is the only other requirement, and vodclip offers to install it for you: if it is missing, the CLI probes the system for a package manager (winget, brew, scoop, choco, pipx, uv) and asks before running anything. `--no-install` skips the prompt and fails fast instead. ffmpeg is checked the same way, because cutting at exact timestamps needs it.

Manual installs:
- Windows: `winget install -e --id yt-dlp.yt-dlp`
- macOS: `brew install yt-dlp`
- Linux: `pipx install yt-dlp`
- Kick VODs sit behind Cloudflare. yt-dlp impersonates a browser automatically. If that fails, install the impersonation extras: `pip install -U "yt-dlp[default,curl-cffi]"`

## Notes

- vodclip supports public VODs only. Sub-only VODs need a platform login, and the tool does not handle logins.
- A large start timestamp makes the download slow. yt-dlp streams from the start of the VOD to your cut point. Wait for the download to finish.

A web UI lives at [katsugtgz.github.io/vodclip](https://katsugtgz.github.io/vodclip/). Paste a link, tune start and duration, copy the command. It builds the command in the browser and deep-links with `?u=<url>&t=<start>&d=<seconds>`.

## Development

```bash
npm install
npm test            # unit tests (node:test)
npm run test:coverage
npm run lint
npm run dry-run     # prints the yt-dlp command without downloading
```

## Releases

Releases are tag driven. Push a tag that matches the `package.json` version (example: tag `v0.2.0` for version `0.2.0`), and the Publish workflow tests, publishes to npm with provenance, and opens a GitHub release. It uses npm trusted publishing, so no `NPM_TOKEN` secret is stored. One-time setup: add this repo and workflow as a Trusted Publisher in the npm package settings.

A weekly live smoke test cuts a 5-second clip from a public VOD. It opens an issue when it fails.

## License

MIT
