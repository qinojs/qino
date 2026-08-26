// nicht verwendet. ist dieses script besser als htmlText.ts?

import { Parser } from "htmlparser2";

// Arbitrary HTML as the readable text a channel without markup sends. Not a conversion of a
// document — a rescue of what it says: structure becomes line breaks, links keep their address,
// and everything that only speaks to a browser (comments, scripts, styles) is gone.

/** Elements whose content is not text at all. */
const SKIP = new Set(["script", "style", "head", "title", "noscript", "template", "svg", "math"]);
/** Elements that end a line, and those that leave a blank one behind. */
const LINE = new Set(["br", "div", "li", "tr", "dt", "dd", "address", "figcaption", "caption"]);
const BLOCK = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "table", "ul", "ol",
  "dl", "figure", "section", "article", "header", "footer", "main", "aside", "form"]); // hr alone — it closed twice
/** Addresses that say nothing the text does not say already. */
const MUTE = /^(?:#|javascript:|data:|$)/i;
/** Hidden from the reader — a mail's preheader spacer is the usual one, and it must not be read out. */
const INVISIBLE = /display\s*:\s*none|visibility\s*:\s*hidden/i;
/** Characters that only pad a layout: joiners, zero-width spaces, soft hyphens. */
const PADDING = /[\u034f\u00ad\u200b-\u200d\ufeff]/g;

const unseen = (attribs: Record<string, string>) =>
  attribs.hidden != null || attribs["aria-hidden"] === "true" || INVISIBLE.test(attribs.style ?? "");

export function htmlToText(html: string): string {
  let out = "";
  let hide = 0; // depth inside a subtree the reader never sees
  let pre = 0;
  let href = "";
  let linked = "";
  let address = false; // an address was just written — no word may stick to it
  const lists: { ordered: boolean; n: number }[] = [];

  const write = (text: string) => {
    out += text;
    if (href) linked += text;
  };
  /** Break up to `n` lines, counting what is already there — a page full of divs stays readable. */
  const breaks = (n: number) => {
    address = false;
    if (pre) return void (out += "\n");
    const has = /\n*$/.exec(out)![0].length;
    if (out && has < n) out += "\n".repeat(n - has);
  };

  const parser = new Parser({
    onopentag(name, attribs) {
      if (hide) return void hide++;
      if (SKIP.has(name) || unseen(attribs)) return void (hide = 1);
      if (name === "pre") pre++;
      if (name === "br") return write("\n"); // <br><br> is how mail writes a blank line, so they add up
      if (name === "hr") { breaks(2); write("---"); return breaks(2); }
      if (name === "img") {
        // alt skips the usual text path — normalize it here or line breaks leak straight through
        const alt = attribs.alt?.replace(/\s+/g, " ").trim();
        return void (alt && write(alt));
      }
      if (name === "a") { href = (attribs.href ?? "").trim(); linked = ""; return; }
      if (name === "ul" || name === "ol") { breaks(1); return void lists.push({ ordered: name === "ol", n: 0 }); }
      if (name === "li") {
        breaks(1);
        const list = lists.at(-1);
        return write("  ".repeat(Math.max(0, lists.length - 1)) + (list?.ordered ? `${++list.n}. ` : "• "));
      }
      if ((name === "td" || name === "th") && out && !out.endsWith("\n")) return write("\t");
      if (BLOCK.has(name)) breaks(2);
      else if (LINE.has(name)) breaks(1);
    },
    ontext(text) {
      if (hide) return;
      if (pre) return write(text);
      const flat = text.replace(/\s+/g, " ");
      if (address && /^\w/.test(flat)) write(" "); // punctuation may follow an address, a word may not
      address = false;
      write(out.endsWith("\n") || !out ? flat.trimStart() : flat);
    },
    onclosetag(name) {
      if (hide) return void hide--;
      if (name === "a") {
        // the address is the message in plain text: keep it unless the text already is the address
        // zero-width padding is invisible to trim(), yet would spoil both comparisons
        const text = linked.replace(PADDING, "").trim();
        // compare the mailto form loosely — but only compare; print the address as sent
        if (href && !MUTE.test(href) &&
            href !== text && href.toLowerCase() !== `mailto:${text}`.toLowerCase()) {
          write(text && !out.endsWith("\n") ? `: ${href}` : href);
          address = true;
        }
        href = "";
        return;
      }
      if (name === "ul" || name === "ol") { lists.pop(); return breaks(2); }
      if (name === "pre") pre = Math.max(0, pre - 1);
      if (BLOCK.has(name)) return breaks(2);
      if (LINE.has(name)) return breaks(1);
    },
  }, { decodeEntities: true });

  // strip CR first: CRLF and lone CR would otherwise survive <pre> verbatim
  parser.write(html.replace(/\r\n?/g, "\n"));
  parser.end();
  // a non-breaking space is a layout trick, not a character anyone wants in plain text
  return out.replace(/\u00a0/g, " ").replace(PADDING, "")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}