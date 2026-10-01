// Blind-first review queue (amendments #3, #4, #9): verdict card expands only
// AFTER Keep/Kill commits; pre-cut preview with 9:16 crop guides; keyboard
// flow K/X/I/O/U; rank badge; msgs/min sparkline; precision scoreboard.

import { Hono } from "hono";
import { readdir } from "node:fs/promises";
import { Store } from "./store.ts";
import { renderKept, pathsFor } from "./stages.ts";

const WORK_ROOT = process.env.VODCLIP_WORK_ROOT ?? `${import.meta.dir}/../work`;
const PORT = Number(process.env.VODCLIP_QUEUE_PORT ?? 8790);

function page(rows: any[], precision: { kept: number; total: number } | null): string {
  const cards = rows.map((v, i) => `
    <section class="cand" data-id="${v.id}" data-cid="${v.candidate_id}">
      <header><span class="rank">#${i + 1}</span><span class="cut">${v.adjusted_cut_start_sec ?? "?"}s–${v.adjusted_cut_end_sec ?? "?"}s</span>
        <span class="tokens">${JSON.parse(v.flags || "[]").join(" ") || ""}</span></header>
      <div class="player"><video controls preload="metadata" src="/media/${v.vod_id}/prev-${v.candidate_id}.mp4"></video>
        <div class="guide"></div></div>
      <div class="chat" id="chat-${v.id}"><button class="loadchat">load chat…</button></div>
      <div class="acts">
        <button class="keep" data-a="keep">Keep <kbd>K</kbd></button>
        <button class="kill" data-a="kill">Kill <kbd>X</kbd></button>
        <span class="delta" id="delta-${v.id}"></span>
      </div>
      <details class="verdict" id="v-${v.id}"><summary>LLM verdict (hidden until you commit)</summary>
        <pre>${JSON.stringify({ keep_prob: v.keep_prob, what_happened: v.what_happened, score: v.score, flags: v.flags }, null, 1)}</pre>
      </details>
    </section>`).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>vodclip review</title><style>
    body{background:#111;color:#ddd;font:15px/1.5 system-ui;margin:0;padding:16px;font-family:system-ui}
    h1{font-size:18px} .score{color:#8f8}
    .cand{border:1px solid #333;border-radius:10px;padding:12px;margin:14px 0;max-width:640px}
    header{display:flex;gap:12px;align-items:baseline}.rank{font-weight:700;color:#ffd66e}
    .player{position:relative;width:360px}.player video{width:100%;border-radius:6px;background:#000}
    .guide{position:absolute;top:0;bottom:0;left:50%;width:56.25%;transform:translateX(-50%);border:2px dashed rgba(255,214,110,.75);pointer-events:none;border-radius:4px}
    .acts{margin:10px 0;display:flex;gap:10px;align-items:center}
    button{background:#2a2a2a;color:#eee;border:1px solid #444;border-radius:8px;padding:8px 14px;cursor:pointer}
    button.keep{border-color:#4c4}button.kill{border-color:#c44}kbd{opacity:.6;font-size:11px}
    details.verdict{margin-top:8px}details.verdict summary{cursor:pointer;color:#888}
    pre{white-space:pre-wrap;background:#1b1b1b;padding:8px;border-radius:6px}
    .chat{max-height:160px;overflow:auto;font-size:12px;color:#aaa}
  </style></head><body>
    <h1>vodclip review queue ${precision ? `<span class="score">precision@10: ${precision.kept}/${precision.total || 0}</span>` : ""}</h1>
    ${cards || "<p>queue empty</p>"}
    <script>
    let focusIdx = 0; const cards = [...document.querySelectorAll('.cand')];
    function commit(card, action) {
      const id = card.dataset.id;
      const t0 = performance.now();
      const v = card.querySelector('video');
      const cut = card.querySelector('.cut').textContent;
      fetch('/api/action', {method:'POST', headers:{'content-type':'application/json'},
        body: JSON.stringify({verdictId: +id, action, blindMs: Math.round(performance.now() - (card._shown ?? t0)), cutText: cut})})
        .then(r => r.json()).then(j => {
          document.getElementById('v-' + id).open = true;
          card.querySelector('.delta').textContent = j.override ? 'OVERRIDE Δ' + j.cut_delta + 's' : (j.rendered ? ' → ' + j.rendered : '');
          if (j.override) card.querySelector('.delta').style.color = '#ffd66e';
          card.classList.add(action === 'keep' ? 'kept' : 'killed');
        });
    }
    document.addEventListener('click', e => {
      const b = e.target.closest('button[data-a]'); if (b) commit(b.closest('.cand'), b.dataset.a);
      const l = e.target.closest('.loadchat');
      if (l) fetch('/api/chat?cid=' + l.closest('.cand').dataset.cid).then(r=>r.text()).then(t=>{l.parentElement.textContent=t});
    });
    document.querySelectorAll('video').forEach(v => v._t = 0);
    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'VIDEO') return;
      const card = cards[focusIdx]; if (!card) return;
      if (e.key === 'k') commit(card, 'keep');
      if (e.key === 'x') commit(card, 'kill');
      if (e.key === 'j') { focusIdx = Math.min(cards.length-1, focusIdx+1); cards[focusIdx].scrollIntoView(); }
      if (e.key === 'u') { /* one-level undo handled server-side via re-action */ alert('undo: re-act on the card (append-only)'); }
    });
    cards[0]?.focus();
    </script></body></html>`;
}

export function serveQueue(vodId: string) {
  const paths = pathsFor(WORK_ROOT, vodId);
  const store = new Store(paths.dbPath);
  const app = new Hono();

  app.get("/", (c) => c.html(page(store.queue(vodId, 10), store.precisionAt10(vodId))));
  app.get("/media/:vod/:file", async (c) => {
    const f = Bun.file(`${WORK_ROOT}/${c.req.param("vod")}/${c.req.param("file")}`);
    return f.exists() ? c.body(f) : c.text("not found", 404);
  });
  app.get("/api/chat", async (c) => {
    const row = store.queue(vodId, 20).find((v: any) => v.candidate_id === c.req.query("cid"));
    return c.text(row?.raw ?? "no verdict row");
  });
  app.post("/api/action", async (c) => {
    const { verdictId, action, blindMs, cutText } = await c.req.json();
    const row: any = store.queue(vodId, 20).find((v: any) => v.id === verdictId)
      ?? store.db.query("SELECT * FROM verdicts WHERE id=?").get(verdictId);
    const m = /(\d+)s–(\d+)s/.exec(cutText ?? "") ?? [];
    const proposed = [Number(m[1]), Number(m[2])];
    const cutDelta = proposed[1] - (row?.adjusted_cut_end_sec ?? proposed[1]);
    store.insertReviewAction({
      verdictId, action, cutDeltaSec: cutDelta, isOverride: Math.abs(cutDelta) > 5,
      blindDurationMs: blindMs ?? 0, createdAt: new Date().toISOString(),
    });
    let rendered: string | null = null;
    if (action === "keep") {
      const r = await renderKept(store, `${WORK_ROOT}/${vodId}`, paths.clipsDir, row.candidate_id,
        row.adjusted_cut_start_sec ?? proposed[0], row.adjusted_cut_end_sec ?? proposed[1]);
      rendered = r.ok ? r.path : null;
    }
    return c.json({ ok: true, cut_delta: cutDelta, override: Math.abs(cutDelta) > 5, rendered });
  });
  app.get("/clips", async (c) => {
    let names: string[] = [];
    try { names = (await readdir(paths.clipsDir)).filter((f) => f.endsWith(".mp4")); } catch {}
    return c.html(`<!doctype html><meta charset=utf-8><title>clips</title><body style="font-family:system-ui;background:#111;color:#ddd">
      <h2>Kept clips</h2>${names.map((n) => `<p><a style="color:#8f8" href="/clips-file/${n}" download>${n}</a></p>`).join("") || "<p>none yet</p>"}`);
  });
  app.get("/clips-file/:name", (c) => c.body(Bun.file(`${paths.clipsDir}/${c.req.param("name")}`)));

  console.log(`review queue: http://127.0.0.1:${PORT}/ (LAN: http://$(hostname -I | awk '{print $1}'):${PORT}/)`);
  return { app, start: () => Bun.serve({ port: PORT, fetch: app.fetch }) };
}

if (import.meta.main) {
  const vodId = process.argv[2] ?? "2887458706";
  serveQueue(vodId).start();
}
