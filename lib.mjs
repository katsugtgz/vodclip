// Pure helpers for vodclip. No side effects, safe to unit test.

export function parseStart(raw) {
  if (raw == null || raw === "") return 0;
  const s = String(raw).trim().toLowerCase();

  const hms = s.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})$/);
  if (hms) return (+hms[1] || 0) * 3600 + +hms[2] * 60 + +hms[3];

  const t = s.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (t && (t[1] || t[2] || t[3])) {
    return (+t[1] || 0) * 3600 + (+t[2] || 0) * 60 + (+t[3] || 0);
  }
  if (/^\d+$/.test(s)) return +s;
  return null;
}

export function fmt(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function classify(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return null; }
  const host = u.hostname.replace(/^www\./, "");

  if (host === "twitch.tv" || host.endsWith(".twitch.tv")) {
    const vod = u.pathname.match(/^\/videos\/(\d+)/);
    const clip = u.pathname.match(/^\/[^/]+\/clip\/([\w-]+)/) || u.pathname.match(/^\/clips?\/([\w-]+)/);
    if (clip) return { platform: "twitch", id: clip[1], kind: "clip", url: rawUrl };
    if (vod) return { platform: "twitch", id: vod[1], kind: "vod", url: rawUrl, t: u.searchParams.get("t") };
    return null;
  }
  if (host === "kick.com") {
    const vod = u.pathname.match(/^\/video\/([\w-]+)/) || u.pathname.match(/^\/[^/]+\/videos\/([\w-]+)/);
    const clip = u.pathname.match(/^\/clips?\/([\w-]+)/);
    if (clip) return { platform: "kick", id: clip[1], kind: "clip", url: rawUrl };
    if (vod) return { platform: "kick", id: vod[1], kind: "vod", url: rawUrl, t: u.searchParams.get("t") };
    return null;
  }
  return null;
}
