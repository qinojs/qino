import { hee } from "@qino/qino";

import { htmlOf, textOf, textToHtml } from "./format.ts";
import { rewriteLinks, shortenOwn } from "./links.ts";
import { markers, PIXEL } from "./track.ts";

import type { App, Row } from "@qino/qino";
import type { Msg } from "../mod.ts";
import type { Profile } from "./format.ts";

// The template a channel puts around every message: `{{content}}` is the message itself, every
// other placeholder is what this channel knows about the recipient. It belongs to the channel, so
// the same message arrives as a signed mail and as a bare line of SMS.

const PLACEHOLDER = /\{\{\s*(\w+)\s*(?:\|([^}]*))?\}\}/g;
const CONTENT = "{{content}}";
/** Markup that opens with a block of its own — it needs no paragraph around it. */
const BLOCK = /^\s*<(?:p|h[1-6]|ul|ol|blockquote|pre|table|div|figure|hr)\b/i;

/**
 * Load the message's template and shorten its addresses once, then render it for each recipient.
 *
 * The template is the one the message names, else the channel's main one, and none at all when the
 * message asks for none. The result has markup whenever the message or its template has any. `to` is
 * the recipient row the channel already holds — its columns are the placeholders, a missing one
 * falls back to what it names after `|`, and its `deliveryId` is what makes the links tracked.
 */
export async function renderer(
  app: App,
  msg: Msg,
  channel: string,
  profile: Profile = "html",
): Promise<(to?: Row) => Promise<{ text: string; html?: string }>> {
  const template = msg.template === "" ? undefined : await load(app, channel, msg.template);
  // the template is part of what goes out, so its links are shortened with the message's own
  const [body, chrome] = await Promise.all([rewriteLinks(app, msg), template ? rewriteLinks(app, template) : undefined]);
  const render = templated(chrome?.msg, body.msg, profile);
  // only real markup carries a beacon: telegram's subset has no <img>, and an unknown tag there
  // is not ignored but refused — `can't parse entities`, and the message never goes out
  const beacon = profile === "html" ? await shortenOwn(app, PIXEL) : undefined;
  const links = [...body.links, ...chrome?.links ?? [], ...beacon ? [{ url: beacon, kind: "load" as const }] : []];
  const marking = markers(app, links);
  // only the ones actually named: working out a value per recipient is not worth spending on
  // a template that never mentions it
  const named = names(body.msg.text, chrome?.msg.text);
  const asked = Object.entries(placeholders(app)).filter(([name]) => named.has(name));

  return async (to = {}) => {
    const out = render(await computeAll(app, asked, to));
    const id = Number(to.deliveryId);
    if (!id) return out; // no delivery to name: the links stay merely short
    const mark = await marking(id);
    const html = out.html && mark(out.html + (beacon ? `<img src="${beacon}" width="1" height="1" alt="">` : ""));
    return { text: mark(out.text), html };
  };
}

/** A placeholder the renderer works out per recipient, in the two forms a message goes out in. */
export type Computed = Record<string, { text: string; html: string }>;

/**
 * What a module contributes as `export const messagingPlaceholders`, keyed by the name a template
 * writes between braces. It answers per recipient and in both forms, because a value that is a
 * link in markup is a bare address in text. Nothing back means the hole stays empty — a recipient
 * this placeholder has nothing to say about.
 */
export type Placeholder = (app: App, to: Row) => Promise<{ text: string; html: string } | undefined>;

/** The same with the template in hand — what a preview of an unwritten template needs. */
export function templated(
  template: Msg | undefined,
  msg: Msg,
  profile: Profile = "html",
): (placeholders?: Computed) => { text: string; html?: string } {
  const text = textOf(msg);
  const html = htmlOf(msg, profile);
  const templateText = template ? textOf(template) : CONTENT;
  // a paragraph holding nothing but the placeholder is a hole, not a paragraph — but only when the
  // message brings blocks of its own; a lifted line of plain text still wants the template's <p>
  const shell = template && htmlOf(template, profile);
  const templateHtml = shell && BLOCK.test(html ?? "") ? shell.replaceAll(`<p>${CONTENT}</p>`, CONTENT) : shell;
  // markup on either side makes it a markup message; the plain side is lifted to match
  const markup = html !== undefined || templateHtml !== undefined;

  return (computed = {}) => {
    // `content` is a placeholder like any other, in both forms like any other
    const all = { ...computed, content: { text, html: html ?? textToHtml(text, profile) } };
    return {
      // only what was assembled here is tidied: without a template it goes out exactly as written
      text: template ? tidy(fill(templateText, all, "text")) : text,
      html: markup ? fill(templateHtml ?? textToHtml(templateText, profile), all, "html") : undefined,
    };
  };
}

/** A template whose placeholders came up empty leaves holes — and on sms a blank line costs money. */
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

/** The channel's variant of that name, else its main one; an unknown name simply has no template. */
function load(app: App, channel: string, name?: string): Promise<Msg | undefined> {
  return name
    ? app.db.row<Msg>`SELECT text, format FROM message_template WHERE name = ${name} AND channel = ${channel}`
    : app.db.row<Msg>`SELECT text, format FROM message_template WHERE channel = ${channel} AND main = ${true}`;
}

/**
 * Put the placeholders in, each in the form this side needs. A name that was not handed in comes
 * out as what it says after `|`, so the set given is at once the registry and the allowlist — and
 * an inherited name like `toString` has no `text` to read, so it is none either.
 *
 * Values go in as they are: whoever made them knew which side they were for. Filling is one round,
 * never a second, so a value that reads like a placeholder stays text.
 */
function fill(template: string, placeholders: Computed, side: "text" | "html"): string {
  return template.replace(PLACEHOLDER, (_, key, fallback = "") => placeholders[key]?.[side] || fallback);
}

/** Which placeholders these texts name at all — the same reading `fill()` does. */
const names = (...texts: (string | undefined)[]) =>
  new Set(texts.flatMap((text) => [...(text ?? "").matchAll(PLACEHOLDER)].map((hit) => hit[1])));

/** What every linked module offers, by the name a template writes between braces. */
function placeholders(app: App): Record<string, Placeholder> {
  return Object.assign({}, ...app.modules.linked().map((mod) => mod.plugin.messagingPlaceholders));
}

/** Work the asked-for ones out for this recipient; one with nothing to say comes out empty,
 *  which is what makes `{{firstname|Kunde}}` fall back to the name it gives. */
async function computeAll(app: App, asked: [string, Placeholder][], to: Row): Promise<Computed> {
  const values: Computed = {};
  for (const [name, make] of asked) values[name] = await make(app, to) ?? EMPTY;
  return values;
}

const EMPTY = { text: "", html: "" };

/** Plain values as placeholders — what a preview hands in, having no real recipient to ask. */
export const asPlaceholders = (row: Row): Computed =>
  Object.fromEntries(Object.entries(row).map(([key, value]) => [key, { text: String(value ?? ""), html: hee(value) }]));
