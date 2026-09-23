import { fillPlaceholders, hee, html as htmlTag, modulePlaceholders, placeholderName as qualify, placeholderNames } from "@qino/qino";

import { htmlOf, textOf, textToHtml } from "./format.ts";
import { rewriteLinks, shortenOwn } from "./links.ts";
import { markers, PIXEL } from "./track.ts";

import type { App, Row, TemplatePlaceholder, TemplateValue } from "@qino/qino";
import type { Msg } from "../mod.ts";
import type { Profile } from "./format.ts";

// Channel templates around every message: `{{content}}` is the message, other placeholders are
// recipient data. Per channel, so the same message can be a signed mail and a plain SMS.

const CONTENT = "{{content}}";
/** Markup starting with a block needs no surrounding paragraph. */
const BLOCK = /^\s*<(?:p|h[1-6]|ul|ol|blockquote|pre|table|div|figure|hr)\b/i;

/**
 * Load the template and shorten links once, then render per recipient.
 *
 * Template: the named one, else the channel's main one; `null` or an unknown name = none. The result
 * has markup if message or template has. `to` is the recipient row: its columns fill the
 * placeholders (missing ones use the `|` fallback), its `deliveryId` enables tracking.
 */
export async function renderer(
  app: App,
  msg: Msg,
  channel: string,
  profile: Profile = "html",
): Promise<{ render: (to?: Row) => Promise<{ text: string; html?: string }>; uses: Set<string> }> {
  const template = msg.template === null ? undefined : await load(app, channel, msg.template);
  // the template's links are shortened too
  const [body, chrome] = await Promise.all([rewriteLinks(app, msg), template ? rewriteLinks(app, template) : undefined]);
  const render = templated(chrome?.msg, body.msg, profile);
  // beacon only for full html: telegram rejects <img> (`can't parse entities`)
  const beacon = profile === "html" ? await shortenOwn(app, PIXEL) : undefined;
  const links = [...body.links, ...chrome?.links ?? [], ...beacon ? [{ url: beacon, kind: "load" as const }] : []];
  const marking = markers(app, links);
  // compute only the placeholders actually used
  const named = placeholderNames(body.msg.text, chrome?.msg.text); // same parsing as `fill()`
  const asked = Object.entries(modulePlaceholders<Row>(app, BARE)).filter(([name]) => named.has(name));

  return {
    // used placeholders, so a channel can react (mail adds unsubscribe headers)
    uses: new Set(asked.map(([name]) => name)),
    render: async (to: Row = {}) => {
      const out = render(await computeAll(app, asked, to));
      const id = Number(to.deliveryId);
      if (!id) return out; // no delivery: links stay short but untracked
      const mark = await marking(id);
      const html = out.html && mark(out.html + (beacon ? `<img src="${beacon}" width="1" height="1" alt="">` : ""));
      return { text: mark(out.text), html };
    },
  };
}

/** A placeholder value per recipient, as text and html. */
export type Computed = Record<string, TemplateValue>;

/**
 * A placeholder, exported by modules as `templatePlaceholders` (keyed by name). Returns a value per
 * recipient in both forms (a link in markup is a plain URL in text). No value = empty.
 */
export type Placeholder = TemplatePlaceholder<Row>;

/** Same with a given template (for previews of unsaved templates). */
export function templated(
  template: Msg | undefined,
  msg: Msg,
  profile: Profile = "html",
): (placeholders?: Computed) => { text: string; html?: string } {
  const text = textOf(msg);
  const html = htmlOf(msg, profile);
  const templateText = template ? textOf(template) : CONTENT;
  // a paragraph with only the placeholder is dropped — but only if the message has its own blocks;
  // plain text converted to markup keeps the template's <p>
  const shell = template && htmlOf(template, profile);
  const templateHtml = shell && BLOCK.test(html ?? "") ? shell.replaceAll(`<p>${CONTENT}</p>`, CONTENT) : shell;
  // markup on either side makes it markup; the plain side is converted
  const markup = html !== undefined || templateHtml !== undefined;

  return (computed = {}) => {
    // `content` is a normal placeholder
    const all = { ...computed, content: { text, html: htmlTag.raw(html ?? textToHtml(text, profile)) } };
    return {
      // tidy only the template output; without a template the text stays as written
      text: template ? tidy(fill(templateText, all, "text")) : text,
      html: markup ? fill(templateHtml ?? textToHtml(templateText, profile), all, "html") : undefined,
    };
  };
}

/** Remove gaps left by empty placeholders (on sms every character costs). */
const tidy = (text: string) => text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

/** All templates, channel variants grouped by name. */
export function templates(app: App): Promise<Row[]> {
  return app.db.query`SELECT * FROM message_template ORDER BY name, channel`;
}

/** Save a template; a new main template takes over the flag (one per channel). */
export function saveTemplate(app: App, row: Row): Promise<unknown> {
  return app.db.transaction(async () => {
    if (row.main) await app.db.exec`UPDATE message_template SET main = ${false} WHERE channel = ${row.channel}`;
    await app.db.table("message_template").ensure(row);
  });
}

/** The channel's variant of that name, else its main one; unknown name = none. */
function load(app: App, channel: string, name?: string): Promise<Msg | undefined> {
  return name
    ? app.db.row<Msg>`SELECT text, format FROM message_template WHERE name = ${name} AND channel = ${channel}`
    : app.db.row<Msg>`SELECT text, format FROM message_template WHERE channel = ${channel} AND main = ${true}`;
}

/**
 * Insert the placeholders in the right form. Unknown names get their `|` fallback, so the given set
 * is also the allowlist (inherited names like `toString` have no `text`).
 *
 * Values are inserted as is. One pass only, so a value that looks like a placeholder stays text.
 */
function fill(template: string, placeholders: Computed, side: "text" | "html"): string {
  return fillPlaceholders(template, (name) => side === "text"
    ? placeholders[name]?.text
    : String(placeholders[name]?.html ?? hee(placeholders[name]?.text)));
}

/** Placeholder name in templates: messaging's own unprefixed, others prefixed with their module,
 *  so two modules can both have an `email`. */
export const placeholderName = (mod: string, name: string): string => qualify(mod, name, BARE);

/** The module whose placeholders are unprefixed. */
const BARE = "messaging";

/** Compute the used placeholders for this recipient; empty ones use their fallback
 *  (`{{givenName|Kunde}}`). */
async function computeAll(app: App, asked: [string, Placeholder][], to: Row): Promise<Computed> {
  const values: Computed = {};
  for (const [name, make] of asked) values[name] = await make(app, to) ?? EMPTY;
  return values;
}

const EMPTY = { text: "" };
