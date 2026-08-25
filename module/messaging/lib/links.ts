import { Parser } from "htmlparser2";
import { Marked } from "marked";

import type { App } from "@qino/qino";
import type { Tokens } from "marked";
import type { Msg } from "../mod.ts";

// Every address a message points at, made absolute and traded for a short code — once per
// message, never per recipient. What tells the recipients apart is appended in ./track.ts.

/** What reaching an address means: the recipient followed it, or their client loaded it. */
export type Kind = "click" | "load";

/** An address and what reaching it means. */
export type Link = { url: string; kind: Kind };

/** Bare addresses in plain text; what trails them is the sentence's. */
const BARE = /\bhttps?:\/\/[^\s<>"']+/gi;
const TAIL = /[.,;:!?)\]]+$/;
/** Already absolute — normalising it would edit what was written. */
const ABSOLUTE = /^https?:\/\//i;
/** An address still holding a placeholder is no address yet: it is filled per recipient. */
const UNFILLED = /\{\{/;

// Only ever lexes; what renders markdown lives in ./format.ts.
const markdown = new Marked({ gfm: true, breaks: true });

/** One address of our own, shortened like any other — what the open beacon points at. */
export async function shortenOwn(app: App, path: string): Promise<string | undefined> {
  const short = shortener(app);
  const root = await app.url().catch(() => "");
  return short && root ? await short.shorten(app, root + path) : undefined;
}

/** The message with every address absolute and, where a shortener is linked, shortened.
 *  `links` are the shortened ones alone — only they can carry a marker. */
export async function rewriteLinks(app: App, msg: Msg): Promise<{ msg: Msg; links: Link[] }> {
  if (!msg.text) return { msg, links: [] };
  // nothing to be absolute against, so nothing is touched
  const root = await app.url().catch(() => "");
  if (!root) return { msg, links: [] };
  const short = shortener(app);
  const trades = new Map<string, string>(); // what stands there → what goes out
  const links = new Map<string, Link>(); // by what goes out: two spellings may reach the same link
  const swap = async ({ url, kind }: Link): Promise<string> => {
    const known = trades.get(url);
    if (known !== undefined) return known;
    const target = absolute(url, root); // mailto, tel, cid, an anchor: nothing to trade
    // our own grant is the secret itself; a foreign `sig` means whatever that host decided
    const grant = target?.href.startsWith(root) && target.searchParams.has("sig");
    const link = target && short && !grant ? await short.shorten(app, target.href) : undefined;
    const to = link ?? (!target || ABSOLUTE.test(url.trim()) ? url : target.href);
    trades.set(url, to);
    if (link) links.set(link, { url: link, kind }); // only a short link is worth a marker
    return to;
  };
  let text: string;
  if (msg.format === "md") { // the lexer says which addresses, not where they stand
    for (const link of fromMarkdown(msg.text)) await swap(link);
    text = trade(msg.text, trades);
  } else {
    text = await spliced(msg.text, msg.format === "html" ? fromHtml(msg.text) : bare(msg.text), swap, msg.format === "html");
  }
  return { msg: text === msg.text ? msg : { ...msg, text }, links: [...links.values()] };
}

/** The shortener a linked module declares — shorturl's, when it is there. */
function shortener(app: App) {
  const mod = app.modules.linked().find((mod) => mod.plugin.shortener);
  return mod?.plugin.shortener as { shorten(app: App, url: string): Promise<string> } | undefined;
}

/** An address and where it stands, so it can be traded without touching what surrounds it. */
type Span = Link & { at: number; end: number };

/** Where an address stands in a tag; which tags name one is the parser's business. */
const ATTR = /\b(?:href|src)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i;
/** Text these wrap is being shown, not offered — the same rule markdown's code blocks get. */
const QUIET = new Set(["code", "pre", "script", "style"]);

/** Entity forms an address is written in when it stands in markup. */
const ENTITY = /&(?:amp|#38|#x26);/gi;
/** Any other entity is where the address ends: `&amp;` is part of it, `&nbsp;` is what follows. */
const BOUNDARY = /&(?!amp;|#38;|#x26;)[a-z#][a-z0-9]*;/i;
const decode = (url: string) => url.replace(ENTITY, "&");

/** Bare addresses in a text, wherever they stand. */
function bare(text: string, offset = 0, markup = false): Span[] {
  return [...text.matchAll(BARE)].map((m) => {
    const url = (markup ? m[0].split(BOUNDARY)[0] : m[0]).replace(TAIL, "");
    return { url: decode(url), kind: "click" as const, at: offset + m.index, end: offset + m.index + url.length };
  });
}

/** Every address the markup points at: what a tag names, and what merely stands there written out.
 *  A link whose label is its own address is traded on both sides — the same address, so the same
 *  code, and plain text has one link to show instead of a long one beside a short one. */
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
    // raw, or an entity would cut a text into pieces and an address with it
  }, { decodeEntities: false });
  parser.end(html);
  return spans;
}

/** The parser, not a pattern: an address inside a code block is being shown, not offered. */
function fromMarkdown(md: string): Link[] {
  const links: Link[] = [];
  markdown.walkTokens(markdown.lexer(md), (token) => {
    if (token.type === "link") links.push({ url: (token as Tokens.Link).href, kind: "click" });
    else if (token.type === "image") links.push({ url: (token as Tokens.Image).href, kind: "load" });
  });
  return links;
}

/** Absolute as a browser would read it; what is not a web address stays as written. */
function absolute(url: string, root: string): URL | undefined {
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith("#") || UNFILLED.test(trimmed)) return;
  const target = URL.parse(trimmed, root) ?? undefined;
  if (target?.protocol !== "http:" && target?.protocol !== "https:") return;
  return target;
}

/** Trade them all at once, longest first — one address may be the beginning of another. */
function trade(text: string, trades: Map<string, string>): string {
  const changed = [...trades].filter(([from, to]) => from !== to).sort((a, b) => b[0].length - a[0].length);
  for (const [from, to] of changed) text = text.replaceAll(from, to);
  return text;
}

/** Trade each address where it stands, and leave every other character as it was written. */
async function spliced(text: string, spans: Span[], swap: (link: Link) => Promise<string>, markup: boolean): Promise<string> {
  let out = "";
  let at = 0;
  for (const span of spans.sort((a, b) => a.at - b.at)) {
    if (span.at < at) continue; // it stands inside one already traded
    const to = await swap(span);
    out += text.slice(at, span.at) +
      (to === span.url ? text.slice(span.at, span.end) : markup ? to.replaceAll("&", "&amp;") : to);
    at = span.end;
  }
  return out + text.slice(at);
}
