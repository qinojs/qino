import { b64url, randB64 } from "@qino/qino";

import manifest from "./manifest.json" with { type: "json" };

import type { App, ResHtml } from "@qino/qino";

const { name } = manifest;

/** An address, anchored on "@" with the local part as lookbehind — the engine searches a literal,
 *  about 10× faster on big pages. */
const ADDRESS = /(?<=([\w.!#$%&'*+/=?^{|}~-]+))@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;

/** Regions an address is left alone in: code, text shown verbatim, and comments. */
const BLOCKS = /<(script|style|textarea)\b[^>]*>[\s\S]*?<\/\1|<!--[\s\S]*?-->/gi;

const encoder = new TextEncoder();

/** Random lowercase letters — valid as a class name and as visible text. */
const letters = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => String.fromCharCode(97 + b % 26)).join("");

/** XOR with the page key, base64url — undoing it takes this page, not knowledge of the scheme. */
const encode = (address: string, key: string) => b64url(encoder.encode(address).map((b, i) => b ^ key.charCodeAt(i % key.length)));

const blockRanges = (body: string) => [...body.matchAll(BLOCKS)].map((m) => [m.index, m.index + m[0].length]);

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.on("html-ready", ({ ctx }) => {
    // Skip signed-in users: backend and inline editing need the real addresses.
    if (!ctx.res.hasHtml || ctx.user) return;
    protect(ctx.res.html, ctx.req.moduleUrl);
  }, { signal });
}

/** Breaks every address in the body for anything reading the markup, its text, or the href. */
export function protect(html: ResHtml, moduleUrl: string): void {
  const body = html.content;
  if (!body.includes("@")) return; // most pages end here, before any scanning
  const cls = letters(6), decoy = letters(5), key = randB64(6);
  let blocks: number[][] | undefined; // scanned once, on the first hit that could sit in one
  let out = "", last = 0, texts = 0, links = 0;

  for (const hit of body.matchAll(ADDRESS)) {
    const at = hit.index, start = at - hit[1].length;
    const lt = body.lastIndexOf("<", start), gt = body.lastIndexOf(">", start);

    if (lt > gt) { // inside a tag: only mailto hrefs can be restored later
      if (!/^<a[\s>]/i.test(body.slice(lt, lt + 3))) continue;
      if (body.slice(start - 7, start).toLowerCase() !== "mailto:") continue;
      out += body.slice(last, start) + encode(hit[1] + hit[0], key);
      last = at + hit[0].length;
      links++;
      continue;
    }
    // An odd number of quotes means the ">" was inside an attribute value; leave the address alone.
    if (body.slice(lt + 1, start).split('"').length % 2 === 0) continue;
    blocks ??= blockRanges(body);
    if (blocks.some(([from, to]) => start > from && start < to)) continue;

    out += body.slice(last, at) + `<span class=${cls}>${decoy}</span>`; // hidden decoy, right before the "@"
    last = at;
    texts++;
  }

  if (!texts && !links) return;
  html.content = out + body.slice(last);
  if (texts) html.inlineStyles.add(`.${cls}{display:none}`);
  if (links) { // only the href needs a script; the text form reads correctly without one
    html.jsData[name] = { key };
    html.scripts.add(moduleUrl + name + "/pub/main.js");
  }
}
