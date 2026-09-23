import { Parser } from "htmlparser2";

// HTML as readable plain text for channels without markup: structure becomes line breaks, links
// keep their URL, comments/scripts/styles are removed.

/** Elements without text content. */
const SKIP = new Set(["script", "style", "head", "title", "noscript", "template", "svg", "math"]);
/** Elements that end a line, and those that add a blank line. */
const LINE = new Set(["br", "div", "li", "tr", "dt", "dd", "address", "figcaption", "caption"]);
const BLOCK = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "table", "ul", "ol",
  "dl", "figure", "section", "article", "header", "footer", "main", "aside", "form", "hr"]);
/** URLs that add nothing to the text. */
const MUTE = /^(?:#|javascript:|data:|$)/i;
/** Hidden content (e.g. a mail's preheader spacer) — skipped. */
const INVISIBLE = /display\s*:\s*none|visibility\s*:\s*hidden/i;
/** Layout-only characters: joiners, zero-width spaces, soft hyphens. */
const PADDING = /[\u034f\u00ad\u200b-\u200d\ufeff]/g;

const unseen = (attribs: Record<string, string>) =>
  attribs.hidden != null || attribs["aria-hidden"] === "true" || INVISIBLE.test(attribs.style ?? "");

export function htmlToText(html: string): string {
  let out = "";
  let hide = 0; // depth inside a hidden subtree
  let pre = 0;
  let href = "";
  let linked = "";
  let address = false; // a URL was just written — a following word needs a space
  const lists: { ordered: boolean; n: number }[] = [];

  const write = (text: string) => {
    out += text;
    if (href) linked += text;
  };
  /** Ensure up to `n` line breaks, counting existing ones. */
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
      if (name === "br") return write("\n"); // <br><br> = blank line in mails, so they add up
      if (name === "hr") { breaks(2); write("---"); return breaks(2); }
      if (name === "img") {
        // alt bypasses the text path — normalize here, else line breaks leak through
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
      if (address && /^\w/.test(flat)) write(" "); // punctuation may follow a URL, a word needs a space
      address = false;
      write(out.endsWith("\n") || !out ? flat.trimStart() : flat);
    },
    onclosetag(name) {
      if (hide) return void hide--;
      if (name === "a") {
        // keep the URL unless the link text already is the URL
        // zero-width padding survives trim() but would break both comparisons
        const text = linked.replace(PADDING, "").trim();
        // if the link text ended a line, add the URL without colon
        // compare mailto loosely, but print the URL as sent
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

  // strip CR first, else CRLF / lone CR survive in <pre>
  parser.write(html.replace(/\r\n?/g, "\n"));
  parser.end();
  // non-breaking spaces become normal spaces
  return out.replace(/\u00a0/g, " ").replace(PADDING, "")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
