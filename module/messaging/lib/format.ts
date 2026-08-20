import { hee } from "@qino/qino";

import type { Msg } from "../mod.ts";

// What a message text is, and how the channels carry it: markdown renders to the markup a channel
// accepts, html degrades to plain text, plain text stays untouched. Only what a message needs —
// headings, lists, quotes, code, emphasis, links.

/** Markup a channel accepts. `telegram` is its documented subset: no blocks, no lists, no headings. */
export type Profile = "html" | "telegram";

const CODE = /`([^`\n]+)`/g;
const BOLD = /(\*\*|__)(?=\S)([\s\S]*?\S)\1/g;
const ITALIC = /(\*|_)(?=\S)([^*_\n]*?\S)\1/g;
const STRIKE = /~~(?=\S)([\s\S]*?\S)~~/g;
const LINK = /\[([^\]\n]*)\]\(([^)\s]+)\)/g;
const SAFE = /^(?:https?:|mailto:|tel:|\/|#)/i;

/** The message as plain text — what a channel without markup sends, and what a title is cut from. */
export function textOf(msg: Msg): string {
  if (msg.format === "html") return htmlToText(msg.text);
  if (msg.format === "md") return blocks(msg.text).map(plainBlock).join("\n\n");
  return msg.text;
}

/** The message as markup, or undefined when it is plain text and has none to give. */
export function htmlOf(msg: Msg, profile: Profile = "html"): string | undefined {
  if (msg.format === "html") return msg.text;
  if (msg.format !== "md") return;
  const parts = blocks(msg.text).map((block) => markupBlock(block, profile));
  return profile === "telegram" ? parts.join("\n\n") : parts.join("");
}

/** Plain text as markup: escaped, and its line breaks kept in the way the target keeps them. */
export function textToHtml(text: string, profile: Profile = "html"): string {
  const escaped = hee(text);
  return profile === "telegram" ? escaped : escaped.replace(/\r\n?/g, "\n").replace(/\n/g, "<br>");
}

/** A last readable form of arbitrary HTML — not a conversion, a rescue. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre|table)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'").replace(/&amp;/gi, "&")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** One markdown block: its lines plus what they are. */
type Block = { kind: "p" | "h" | "quote" | "code" | "list"; level: number; ordered?: boolean; lines: string[] };

function blocks(text: string): Block[] {
  const ret: Block[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let open: Block | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (open?.kind === "code") { // a fence runs until it closes, or until the text ends
      if (/^\s*```/.test(line)) open = undefined;
      else open.lines.push(line);
      continue;
    }
    const fence = /^\s*```/.test(line);
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    const quote = line.match(/^>\s?(.*)$/);
    const item = line.match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/);
    if (fence) ret.push(open = { kind: "code", level: 0, lines: [] });
    else if (!line.trim()) open = undefined;
    else if (heading) ret.push(open = { kind: "h", level: heading[1].length, lines: [heading[2]] });
    else if (quote) open = append(ret, open, "quote", quote[1]);
    else if (item) {
      const ordered = !item[1];
      if (open?.kind !== "list" || open.ordered !== ordered) ret.push(open = { kind: "list", level: 0, ordered, lines: [] });
      open.lines.push(item[3]);
    } else open = append(ret, open, "p", line);
  }
  return ret;
}

/** Continues the open block of that kind, or starts one. */
function append(ret: Block[], open: Block | undefined, kind: Block["kind"], line: string): Block {
  if (open?.kind !== kind) ret.push(open = { kind, level: 0, lines: [] });
  open.lines.push(line);
  return open;
}

function markupBlock(block: Block, profile: Profile): string {
  const telegram = profile === "telegram";
  const lines = block.lines.map(inlineHtml);
  switch (block.kind) {
    case "code": {
      const code = hee(block.lines.join("\n"));
      return telegram ? `<pre>${code}</pre>` : `<pre><code>${code}</code></pre>`;
    }
    case "h":
      return telegram ? `<b>${lines[0]}</b>` : `<h${block.level}>${lines[0]}</h${block.level}>`;
    case "quote":
      return `<blockquote>${lines.join(telegram ? "\n" : "<br>")}</blockquote>`;
    case "list": {
      if (telegram) return lines.map((line, i) => `${block.ordered ? `${i + 1}.` : "•"} ${line}`).join("\n");
      const tag = block.ordered ? "ol" : "ul";
      return `<${tag}>${lines.map((line) => `<li>${line}</li>`).join("")}</${tag}>`;
    }
    default:
      return telegram ? lines.join("\n") : `<p>${lines.join("<br>")}</p>`;
  }
}

function plainBlock(block: Block): string {
  if (block.kind === "code") return block.lines.join("\n");
  const lines = block.lines.map(inlineText);
  if (block.kind === "list") return lines.map((line, i) => `${block.ordered ? `${i + 1}.` : "•"} ${line}`).join("\n");
  return lines.join("\n");
}

/** Escaped first, so markup is only ever what the markers asked for. */
function inlineHtml(text: string): string {
  return hee(text)
    .replace(CODE, (_, code) => `<code>${code}</code>`)
    .replace(BOLD, (_, __, inner) => `<b>${inner}</b>`)
    .replace(ITALIC, (_, __, inner) => `<i>${inner}</i>`)
    .replace(STRIKE, (_, inner) => `<s>${inner}</s>`)
    .replace(LINK, (all, label, url) => SAFE.test(url) ? `<a href="${url}">${label || url}</a>` : all);
}

/** The same markers dropped — a link keeps its address, because that is the message. */
function inlineText(text: string): string {
  return text
    .replace(CODE, "$1")
    .replace(BOLD, "$2")
    .replace(ITALIC, "$2")
    .replace(STRIKE, "$1")
    .replace(LINK, (_, label, url) => label && label !== url ? `${label}: ${url}` : url);
}
