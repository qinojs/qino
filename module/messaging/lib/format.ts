import { hee } from "@qino/qino";
import { Marked } from "marked";

import { htmlToText } from "./htmlText.ts";
import { sanitizeHtml } from "./sanitize.ts";

import type { Tokens } from "marked";
import type { Msg } from "../mod.ts";

// Message formats: markdown becomes the channel's markup, html becomes plain text where needed,
// plain text stays untouched.

/** Markup a channel accepts. `telegram`: its subset without blocks, lists and headings. */
export type Profile = "html" | "telegram";

/** Telegram has only inline markup: blocks become lines, lists become bullets. */
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

/** Raw html inside markdown is rendered as text. */
const escaped = { html: ({ text }: Tokens.HTML | Tokens.Tag) => hee(text) };

// Stateless and shared. Their output is not trusted; the sanitizer makes it safe.
const markdown = new Marked({ gfm: true, breaks: true, renderer: escaped });
const markdownTelegram = new Marked({ gfm: true, breaks: true, renderer: { ...escaped, ...bullets } });

/** The message as plain text (for channels without markup, and for titles). */
export function textOf(msg: Msg): string {
  if (msg.format === "html") return htmlToText(msg.text);
  if (msg.format === "md") return htmlToText(render(msg.text, "html"));
  return msg.text;
}

/** The message as markup, or undefined for plain text. */
export function htmlOf(msg: Msg, profile: Profile = "html"): string | undefined {
  // mail gets the html as written; narrower targets are sanitized to what they support
  if (msg.format === "html") return profile === "html" ? msg.text : sanitizeHtml(msg.text, profile);
  if (msg.format !== "md") return;
  return render(msg.text, profile);
}

function render(text: string, profile: Profile): string {
  const parser = profile === "telegram" ? markdownTelegram : markdown;
  return sanitizeHtml(parser.parse(text, { async: false }), profile).trim();
}

/** Plain text as markup: escaped, line breaks kept in the target's way. */
export function textToHtml(text: string, profile: Profile = "html"): string {
  const escaped = hee(text);
  return profile === "telegram" ? escaped : escaped.replace(/\r\n?/g, "\n").replace(/\n/g, "<br>");
}
