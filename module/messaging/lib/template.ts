import { hee } from "@qino/qino";

import { htmlOf, textOf, textToHtml } from "./format.ts";
import { rewriteLinks, shortenOwn } from "./links.ts";
import { markers, PIXEL } from "./track.ts";

import type { App, Row } from "@qino/qino";
import type { Msg } from "../mod.ts";
import type { Profile } from "./format.ts";

// A template is the frame a channel puts around every message: `{{content}}` is the message
// itself, every other marker is what this channel knows about the recipient. The frame belongs to
// the channel, so the same message arrives as a signed mail and as a bare line of SMS.

const MARKER = /\{\{\s*(\w+)\s*(?:\|([^}]*))?\}\}/g;
const CONTENT = "{{content}}";
/** Markup that opens with a block of its own — it needs no paragraph around it. */
const BLOCK = /^\s*<(?:p|h[1-6]|ul|ol|blockquote|pre|table|div|figure|hr)\b/i;

/**
 * Load the message's frame and shorten its addresses once, then render it for each recipient.
 *
 * The frame is the one the message names, else the channel's main one, and none at all when the
 * message asks for none. The result has markup whenever the message or its frame has any. `to` is
 * the recipient row the channel already holds — its columns are the markers, a missing one falls
 * back to what the marker names after `|`, and its `deliveryId` is what makes the links tracked.
 */
export async function renderer(
  app: App,
  msg: Msg,
  channel: string,
  profile: Profile = "html",
): Promise<(to?: Row) => Promise<{ text: string; html?: string }>> {
  const frame = msg.template === "" ? undefined : await load(app, channel, msg.template);
  // the frame is part of what goes out, so its links are shortened with the message's own
  const [body, chrome] = await Promise.all([rewriteLinks(app, msg), frame ? rewriteLinks(app, frame) : undefined]);
  const render = framed(chrome?.msg, body.msg, profile);
  // only real markup carries a beacon — a telegram message is not a page that loads images
  const beacon = profile === "html" ? await shortenOwn(app, PIXEL) : undefined;
  const links = [...body.links, ...chrome?.links ?? [], ...beacon ? [{ url: beacon, kind: "load" as const }] : []];
  const marking = markers(app, links);

  return async (to = {}) => {
    const out = render(to);
    const id = Number(to.deliveryId);
    if (!id) return out; // no delivery to name: the links stay merely short
    const mark = await marking(id);
    const html = out.html && mark(out.html + (beacon ? `<img src="${beacon}" width="1" height="1" alt="">` : ""));
    return { text: mark(out.text), html };
  };
}

/** The same with the frame in hand — what a preview of an unwritten template needs. */
export function framed(frame: Msg | undefined, msg: Msg, profile: Profile = "html"): (to?: Row) => { text: string; html?: string } {
  const text = textOf(msg);
  const html = htmlOf(msg, profile);
  const frameText = frame ? textOf(frame) : CONTENT;
  // a paragraph holding nothing but the marker is a placeholder, not a paragraph — but only when the
  // message brings blocks of its own; a lifted line of plain text still wants the frame's <p>
  const shell = frame && htmlOf(frame, profile);
  const frameHtml = shell && BLOCK.test(html ?? "") ? shell.replaceAll(`<p>${CONTENT}</p>`, CONTENT) : shell;
  // markup on either side makes it a markup message; the plain side is lifted to match
  const markup = html !== undefined || frameHtml !== undefined;

  return (to = {}) => ({
    // only what was assembled here is tidied: an unframed message goes out exactly as it was written
    text: frame ? tidy(fill(frameText, text, to, false)) : text,
    html: markup ? fill(frameHtml ?? textToHtml(frameText, profile), html ?? textToHtml(text, profile), to, true) : undefined,
  });
}

/** A frame whose markers came up empty leaves holes — and on sms a blank line costs money. */
const tidy = (text: string) => text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

/** Every template, the channel variants of one name together. */
export function templates(app: App): Promise<Row[]> {
  return app.db.query`SELECT * FROM message_template ORDER BY name, channel`;
}

/** Write one template; a new main hands the flag over, because a channel has one. */
export function saveTemplate(app: App, row: Row): Promise<unknown> {
  return app.db.transaction(async () => {
    if (row.main) await app.db.exec`UPDATE message_template SET main = ${false} WHERE channel = ${row.channel}`;
    await app.db.table("message_template").ensure(row);
  });
}

/** The channel's variant of that name, else its main one; an unknown name simply has no frame. */
function load(app: App, channel: string, name?: string): Promise<Msg | undefined> {
  return name
    ? app.db.row<Msg>`SELECT text, format FROM message_template WHERE name = ${name} AND channel = ${channel}`
    : app.db.row<Msg>`SELECT text, format FROM message_template WHERE channel = ${channel} AND main = ${true}`;
}

/** The message goes in as it is — it was rendered for this target already; markers do not. */
function fill(frame: string, content: string, to: Row, escape: boolean): string {
  return frame.replace(MARKER, (_, key, fallback = "") => {
    if (key === "content") return content;
    const value = String(to[key] ?? "") || fallback;
    return escape ? hee(value) : value;
  });
}
