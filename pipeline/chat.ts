// TDC chat JSON loader → normalized ChatDoc. Verified against TDC 1.56.5 output:
// emotes live in message.fragments[] with emoticon codes; system/usernotice
// entries carry commenter: null.

import type { ChatDoc, ChatMsg } from "./types.ts";

interface TdcFragment {
  text: string;
  emoticon?: { emoticon_id: string; code?: string };
}

interface TdcComment {
  content_offset_seconds?: number;
  commenter?: { name?: string; login?: string } | null;
  message?: {
    body?: string;
    fragments?: TdcFragment[];
    user_notice_params?: unknown;
  };
}

interface TdcDoc {
  comments?: TdcComment[];
  video?: {
    id?: string | number;
    length?: number;
    title?: string;
    user_name?: string;
    streamer?: { name?: string };
  };
}

const EMOTEISH = /^(?:[A-Z0-9!?À-ɏ]{2,12})$/;

function tokensOf(body: string, fragments: TdcFragment[] | undefined): string[] {
  const out = new Set<string>();
  for (const f of fragments ?? []) {
    if (f.emoticon) {
      const code = (f.emoticon.code || f.text || "").trim();
      if (code) out.add(code);
    }
  }
  // ALLCAPS words from the plain body (chat-spelled emotes like "OOOO", "HUH").
  for (const w of body.split(/\s+/)) {
    const clean = w.replace(/[^A-Za-z0-9!?]/g, "");
    if (clean.length >= 2 && EMOTEISH.test(clean)) out.add(clean);
  }
  return [...out];
}

export function loadTdcChat(json: unknown, vodId: string): ChatDoc {
  const doc = json as TdcDoc;
  const video = doc.video ?? {};
  const msgs: ChatMsg[] = [];
  for (const c of doc.comments ?? []) {
    const t = c.content_offset_seconds;
    if (t == null || t < 0) continue;
    const body = c.message?.body ?? "";
    const user = c.commenter?.name ?? c.commenter?.login ?? null;
    const system = user === null;
    msgs.push({ t, tokens: tokensOf(body, c.message?.fragments), system, body, user });
  }
  msgs.sort((a, b) => a.t - b.t);
  return {
    vodId,
    streamer: video.user_name ?? video.streamer?.name ?? "unknown",
    title: video.title ?? "",
    lengthSec: video.length ?? Math.ceil((msgs.at(-1)?.t ?? 0) + 60),
    msgs,
  };
}

export async function loadTdcChatFile(path: string, vodId: string): Promise<ChatDoc> {
  const raw = await Bun.file(path).text();
  return loadTdcChat(JSON.parse(raw), vodId);
}
