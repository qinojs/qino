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

// Only ever lexes; what renders markdown lives in ./format.ts.
const markdown = new Marked({ gfm: true, breaks: true });

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
  for (const { url, kind } of found(msg)) {
    if (trades.has(url)) continue;
    const target = absolute(url, root);
    if (!target) continue; // mailto, tel, cid, an anchor: nothing to trade
    // our own grant is the secret itself; a foreign `sig` means whatever that host decided
    const grant = target.href.startsWith(root) && target.searchParams.has("sig");
    const link = short && !grant ? await short.shorten(app, target.href) : undefined;
    trades.set(url, link ?? (ABSOLUTE.test(url.trim()) ? url : target.href));
    if (link) links.set(link, { url: link, kind }); // only a short link is worth a marker
  }
  const text = trade(msg.text, trades);
  return { msg: text === msg.text ? msg : { ...msg, text }, links: [...links.values()] };
}

/** The shortener a linked module declares — shorturl's, when it is there. */
function shortener(app: App) {
  const mod = app.modules.linked().find((mod) => mod.plugin.shortener);
  return mod?.plugin.shortener as { shorten(app: App, url: string): Promise<string> } | undefined;
}

/** Every address the message points at, in the order it names them. */
function found(msg: Msg): Link[] {
  if (msg.format === "html") return fromHtml(msg.text);
  if (msg.format === "md") return fromMarkdown(msg.text);
  return [...msg.text.matchAll(BARE)].map((m) => ({ url: m[0].replace(TAIL, ""), kind: "click" }));
}

function fromHtml(html: string): Link[] {
  const links: Link[] = [];
  new Parser({
    onopentag(name, attribs) {
      if (name === "a" && attribs.href) links.push({ url: attribs.href, kind: "click" });
      else if (name === "img" && attribs.src) links.push({ url: attribs.src, kind: "load" });
    },
  }).end(html);
  return links;
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
  if (!trimmed || trimmed.startsWith("#")) return;
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
