import { Parser } from "htmlparser2";
import { Marked } from "marked";

import type { App } from "@qino/qino";
import type { Tokens } from "marked";
import type { Msg } from "../mod.ts";

// Make every link of a message absolute and shorten it — once per message. The per-recipient
// marker is added in ./track.ts.

/** Clicked by the recipient, or loaded by their client. */
export type Kind = "click" | "load";

/** An address and what reaching it means. */
export type Link = { url: string; kind: Kind };

/** URLs in plain text; trailing punctuation is excluded. */
const BARE = /\bhttps?:\/\/[^\s<>"']+/gi;
const TAIL = /[.,;:!?)\]]+$/;
/** Already absolute — left as written. */
const ABSOLUTE = /^https?:\/\//i;
/** A URL containing a placeholder is filled per recipient, so skip it. */
const UNFILLED = /\{\{/;

// Only lexes; rendering is in ./format.ts.
const markdown = new Marked({ gfm: true, breaks: true });

/** An own URL, shortened like any other (used for the beacon). */
export async function shortenOwn(app: App, path: string): Promise<string | undefined> {
  const short = shortener(app);
  const root = await app.url().catch(() => "");
  return short && root ? await short.shorten(app, root + path) : undefined;
}

/** The message with all URLs absolute and, if a shortener is linked, shortened. `links` are only
 *  the shortened ones (only they can carry a marker). */
export async function rewriteLinks(app: App, msg: Msg): Promise<{ msg: Msg; links: Link[] }> {
  if (!msg.text) return { msg, links: [] };
  // no base URL: change nothing
  const root = await app.url().catch(() => "");
  if (!root) return { msg, links: [] };
  const short = shortener(app);
  const trades = new Map<string, string>(); // original → replacement
  const links = new Map<string, Link>(); // by replacement: two spellings may give the same link
  const swap = async ({ url, kind }: Link): Promise<string> => {
    const known = trades.get(url);
    if (known !== undefined) return known;
    const target = absolute(url, root); // mailto, tel, cid, anchors: unchanged
    // our own signed link is the secret itself; don't shorten. Foreign `sig`s mean nothing to us
    const grant = target?.href.startsWith(root) && target.searchParams.has("sig");
    const link = target && short && !grant ? await short.shorten(app, target.href) : undefined;
    const to = link ?? (!target || ABSOLUTE.test(url.trim()) ? url : target.href);
    trades.set(url, to);
    if (link) links.set(link, { url: link, kind }); // only short links get a marker
    return to;
  };
  let text: string;
  if (msg.format === "md") { // the lexer finds the URLs, not their positions
    for (const link of fromMarkdown(msg.text)) await swap(link);
    text = trade(msg.text, trades);
  } else {
    text = await spliced(msg.text, msg.format === "html" ? fromHtml(msg.text) : bare(msg.text), swap, msg.format === "html");
  }
  return { msg: text === msg.text ? msg : { ...msg, text }, links: [...links.values()] };
}

/** The shortener of a linked module (shorturl). */
function shortener(app: App) {
  const mod = app.modules.linked().find((mod) => mod.plugin.shortener);
  return mod?.plugin.shortener as { shorten(app: App, url: string): Promise<string> } | undefined;
}

/** A URL and its position, for replacing it in place. */
type Span = Link & { at: number; end: number };

/** URL attributes of tags. */
const ATTR = /\b(?:href|src)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i;
/** Text inside these is shown, not linked — like markdown code blocks. */
const QUIET = new Set(["code", "pre", "script", "style"]);

/** Entities that may appear inside a URL in markup. */
const ENTITY = /&(?:amp|#38|#x26);/gi;
/** Other entities end the URL: `&amp;` is part of it, `&nbsp;` is not. */
const BOUNDARY = /&(?!amp;|#38;|#x26;)[a-z#][a-z0-9]*;/i;
const decode = (url: string) => url.replace(ENTITY, "&");

/** Plain URLs in a text. */
function bare(text: string, offset = 0, markup = false): Span[] {
  return [...text.matchAll(BARE)].map((m) => {
    const url = (markup ? m[0].split(BOUNDARY)[0] : m[0]).replace(TAIL, "");
    return { url: decode(url), kind: "click" as const, at: offset + m.index, end: offset + m.index + url.length };
  });
}

/** All URLs in markup: tag attributes and plain text URLs. A link labelled with its own URL is
 *  replaced in both places with the same code. */
function fromHtml(html: string): Span[] {
  const spans: Span[] = [];
  let quiet = 0;
  const parser = new Parser({
    onopentag(name) {
      if (QUIET.has(name)) quiet++;
      if (name !== "a" && name !== "img") return;
      const m = html.slice(parser.startIndex, parser.endIndex + 1).match(ATTR);
      if (!m) return;
      const quoted = /^["']/.test(m[1]);
      const raw = quoted ? m[1].slice(1, -1) : m[1];
      const at = parser.startIndex + m.index! + m[0].length - m[1].length + (quoted ? 1 : 0);
      spans.push({ url: decode(raw), kind: name === "a" ? "click" : "load", at, end: at + raw.length });
    },
    ontext() {
      if (quiet) return;
      spans.push(...bare(html.slice(parser.startIndex, parser.endIndex + 1), parser.startIndex, true));
    },
    onclosetag(name) {
      if (QUIET.has(name) && quiet) quiet--;
    },
    // raw, so entities don't split the text and its URLs
  }, { decodeEntities: false });
  parser.end(html);
  return spans;
}

/** Uses the parser, not a regex, so URLs in code blocks are skipped. */
function fromMarkdown(md: string): Link[] {
  const links: Link[] = [];
  markdown.walkTokens(markdown.lexer(md), (token) => {
    if (token.type === "link") links.push({ url: (token as Tokens.Link).href, kind: "click" });
    else if (token.type === "image") links.push({ url: (token as Tokens.Image).href, kind: "load" });
  });
  return links;
}

/** Make absolute like a browser does; non-web addresses stay unchanged. */
function absolute(url: string, root: string): URL | undefined {
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith("#") || UNFILLED.test(trimmed)) return;
  const target = URL.parse(trimmed, root) ?? undefined;
  if (target?.protocol !== "http:" && target?.protocol !== "https:") return;
  return target;
}

/** Replace all at once, longest first — a URL may be the prefix of another. */
function trade(text: string, trades: Map<string, string>): string {
  const changed = [...trades].filter(([from, to]) => from !== to).sort((a, b) => b[0].length - a[0].length);
  for (const [from, to] of changed) text = text.replaceAll(from, to);
  return text;
}

/** Replace each URL in place; everything else stays as written. */
async function spliced(text: string, spans: Span[], swap: (link: Link) => Promise<string>, markup: boolean): Promise<string> {
  let out = "";
  let at = 0;
  for (const span of spans.sort((a, b) => a.at - b.at)) {
    if (span.at < at) continue; // inside an already replaced one
    const to = await swap(span);
    out += text.slice(at, span.at) +
      (to === span.url ? text.slice(span.at, span.end) : markup ? to.replaceAll("&", "&amp;") : to);
    at = span.end;
  }
  return out + text.slice(at);
}
