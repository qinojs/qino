import { keyed, Output, safeEqual, unixTime } from "@qino/qino";

import type { App, Ctx } from "@qino/qino";
import type { Kind, Link } from "./links.ts";

// Who reached which address: the code says which one, the marker behind it which delivery —
// `${link}/${marker}`, stored nowhere until it is followed. Signed, because a bare delivery number
// invites walking 1, 2, 3.

const SIG = 3;
/** Where the open beacon lives; it is shortened like any other address, so nobody ever sees it. */
export const PIXEL = "messaging/open.gif";
const GIF = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="), (c) => c.charCodeAt(0));
/** The kinds by the character standing for them in a marker — their own first one. */
const KIND: Record<string, Kind> = { c: "click", l: "load" };

/** Prepared once per message, then asked per recipient: one pass over the text, and two markers
 *  at most — the code already says which address it was. */
export function markers(app: App, links: Link[]): (deliveryId: number) => Promise<(text: string) => string> {
  if (!links.length) return () => Promise.resolve((text: string) => text);
  const kinds = new Map(links.map(({ url, kind }) => [url, kind]));
  // longest first — one link may be the beginning of another
  const any = new RegExp([...kinds.keys()].sort((a, b) => b.length - a.length).map(RegExp.escape).join("|"), "g");
  return async (deliveryId) => {
    const byKind = new Map<Kind, string>();
    for (const kind of new Set(kinds.values())) byKind.set(kind, await marker(app, deliveryId, kind));
    const marked = new Map([...kinds].map(([url, kind]) => [url, `${url}/${byKind.get(kind)}`]));
    return (text) => text.replace(any, (url) => marked.get(url) ?? url);
  };
}

/** The beacon itself: a transparent pixel, and never a cached one — each open must ask again. */
export function servePixel(ctx: Ctx): void {
  if (ctx.req.appPath !== PIXEL) return; // every request passes here; nothing is allocated to say no
  throw new Output(GIF, { headers: { "Content-Type": "image/gif", "Cache-Control": "no-store" } });
}

/** Note what was reached. Nothing here delays the redirect the visitor is waiting for. */
// deno-lint-ignore no-explicit-any -- module events carry their own payloads
export async function trackHit(app: App, { link, tag }: any): Promise<void> {
  // anyone may shorten: a tag this key cannot read is somebody else's, not a forged one
  const hit = tag && await read(app, String(tag));
  if (!hit) return;
  // a deleted delivery takes its hits with it — the row finds no parent
  app.db.table("message_track").insert({
    delivery_id: hit.deliveryId,
    code: link.code,
    kind: hit.kind,
    time: unixTime(),
  }).catch(() => {});
}

/** `<delivery in base36><kind><signature>` — what a made-up number cannot have. */
async function marker(app: App, deliveryId: number, kind: Kind): Promise<string> {
  const stem = deliveryId.toString(36) + kind[0];
  return stem + await sign(app, stem);
}

const sign = (app: App, stem: string) => keyed(app, ["messaging.track", stem], SIG);

/** What a marker says, or nothing at all when it is not one we handed out. */
async function read(app: App, tag: string): Promise<{ deliveryId: number; kind: Kind } | undefined> {
  const stem = tag.slice(0, -SIG);
  const kind = KIND[stem.slice(-1)];
  const deliveryId = parseInt(stem.slice(0, -1), 36);
  if (!kind || !(deliveryId > 0) || !safeEqual(tag.slice(-SIG), await sign(app, stem))) return;
  return { deliveryId, kind };
}
