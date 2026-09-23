import { keyed, Output, safeEqual, unixTime } from "@qino/qino";

import type { App, Ctx } from "@qino/qino";
import type { Kind, Link } from "./links.ts";

// Click tracking: the code identifies the address, the marker (`${link}/${marker}`) the delivery.
// Stored only when followed. Signed, so nobody can count through delivery numbers.

const SIG = 3;
/** Path of the open beacon; it is shortened like any link. */
export const PIXEL = "messaging/open.gif";
const GIF = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="), (c) => c.charCodeAt(0));
/** Kind by its marker character (first letter). */
const KIND: Record<string, Kind> = { c: "click", l: "load" };

/** Prepared once per message, then applied per recipient: one pass over the text, at most two
 *  markers. */
export function markers(app: App, links: Link[]): (deliveryId: number) => Promise<(text: string) => string> {
  if (!links.length) return () => Promise.resolve((text: string) => text);
  const kinds = new Map(links.map(({ url, kind }) => [url, kind]));
  // longest first — a link may be the prefix of another
  const any = new RegExp([...kinds.keys()].sort((a, b) => b.length - a.length).map(RegExp.escape).join("|"), "g");
  return async (deliveryId) => {
    const byKind = new Map<Kind, string>();
    for (const kind of new Set(kinds.values())) byKind.set(kind, await marker(app, deliveryId, kind));
    const marked = new Map([...kinds].map(([url, kind]) => [url, `${url}/${byKind.get(kind)}`]));
    return (text) => text.replace(any, (url) => marked.get(url) ?? url);
  };
}

/** The beacon: a transparent pixel, never cached, so every open is counted. */
export function servePixel(ctx: Ctx): void {
  if (ctx.req.appPath !== PIXEL) return; // runs on every request: bail out cheaply
  throw new Output(GIF, { headers: { "Content-Type": "image/gif", "Cache-Control": "no-store" } });
}

/** Record a hit, without delaying the redirect. */
// deno-lint-ignore no-explicit-any -- module events carry their own payloads
export async function trackHit(app: App, { link, tag }: any): Promise<void> {
  // any module may shorten: an unreadable tag is someone else's, not forged
  const hit = tag && await read(app, String(tag));
  if (!hit) return;
  // deleted delivery: the insert fails on the missing parent
  app.db.table("message_track").insert({
    delivery_id: hit.deliveryId,
    code: link.code,
    kind: hit.kind,
    time: unixTime(),
  }).catch(() => {});
}

/** `<delivery in base36><kind><signature>`. */
async function marker(app: App, deliveryId: number, kind: Kind): Promise<string> {
  const stem = deliveryId.toString(36) + kind[0];
  return stem + await sign(app, stem);
}

const sign = (app: App, stem: string) => keyed(app, ["messaging.track", stem], SIG);

/** Decode a marker, or nothing if it isn't ours. */
async function read(app: App, tag: string): Promise<{ deliveryId: number; kind: Kind } | undefined> {
  const stem = tag.slice(0, -SIG);
  const kind = KIND[stem.slice(-1)];
  const deliveryId = parseInt(stem.slice(0, -1), 36);
  if (!kind || !(deliveryId > 0) || !safeEqual(tag.slice(-SIG), await sign(app, stem))) return;
  return { deliveryId, kind };
}
