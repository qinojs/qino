import { hee } from "@qino/qino";
import { Marked } from "marked";

import { htmlToText } from "./htmlText.ts";
import { sanitizeHtml } from "./sanitize.ts";

import type { Tokens } from "marked";
import type { Msg } from "../mod.ts";

// What a message text is, and how the channels carry it: markdown renders to the markup a channel
// accepts, html degrades to plain text, plain text stays untouched.

/** Markup a channel accepts. `telegram` is its documented subset: no blocks, no lists, no headings. */
export type Profile = "html" | "telegram";

/** Telegram knows inline markup and nothing else, so blocks become lines and lists become bullets. */
const bullets = {
  heading(this: { parser: { parseInline(t: Tokens.Generic[]): string } }, { tokens }: Tokens.Heading) {
    return `<b>${this.parser.parseInline(tokens)}</b>\n\n`;
  },
  paragraph(this: { parser: { parseInline(t: Tokens.Generic[]): string } }, { tokens }: Tokens.Paragraph) {
    return `${this.parser.parseInline(tokens)}\n\n`;
  },
  list(this: { parser: { parse(t: Tokens.Generic[]): string } }, token: Tokens.List) {
    const start = Number(token.start) || 1;
    return token.items.map((item, i) =>
      `${token.ordered ? `${start + i}.` : "•"} ${this.parser.parse(item.tokens).trim()}`).join("\n") + "\n\n";
  },
  code: ({ text }: Tokens.Code) => `<pre>${hee(text)}</pre>\n\n`,
  hr: () => "---\n\n",
  image: ({ text }: Tokens.Image) => text,
};

/** Raw html inside markdown is text, not markup — the one thing markdown would carry through. */
const escaped = { html: ({ text }: Tokens.HTML | Tokens.Tag) => hee(text) };

// Stateless and shared. Nothing they emit is trusted: markdown carries raw html through, and a
// message is written by whoever sent it — the sanitizer is what makes the output safe.
const markdown = new Marked({ gfm: true, breaks: true, renderer: escaped });
const markdownTelegram = new Marked({ gfm: true, breaks: true, renderer: { ...escaped, ...bullets } });

/** The message as plain text — what a channel without markup sends, and what a title is cut from. */
export function textOf(msg: Msg): string {
  if (msg.format === "html") return htmlToText(msg.text);
  if (msg.format === "md") return htmlToText(render(msg.text, "html"));
  return msg.text;
}

/** The message as markup, or undefined when it is plain text and has none to give. */
export function htmlOf(msg: Msg, profile: Profile = "html"): string | undefined {
  // a document goes to a mail client as it was written; a narrower target only gets what it renders
  if (msg.format === "html") return profile === "html" ? msg.text : sanitizeHtml(msg.text, profile);
  if (msg.format !== "md") return;
  return render(msg.text, profile);
}

function render(text: string, profile: Profile): string {
  const parser = profile === "telegram" ? markdownTelegram : markdown;
  return sanitizeHtml(parser.parse(text, { async: false }), profile).trim();
}

/** Plain text as markup: escaped, and its line breaks kept in the way the target keeps them. */
export function textToHtml(text: string, profile: Profile = "html"): string {
  const escaped = hee(text);
  return profile === "telegram" ? escaped : escaped.replace(/\r\n?/g, "\n").replace(/\n/g, "<br>");
}
