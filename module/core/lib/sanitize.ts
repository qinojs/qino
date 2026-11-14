// @ts-types="@types/sanitize-html"
import sanitize from "sanitize-html";

/** Allowlist for HTML, in the terms of the web Sanitizer API. Additions: `protocols` per element
 *  and attribute, and `styles` (an optional css-property allowlist). */
export type HtmlPolicy = {
  elements: string[];
  attributes: Record<string, string[]>;
  protocols: Record<string, Record<string, string[]>>;
  /** Allowed inline css properties per element. Missing element = all. */
  styles?: Record<string, Record<string, RegExp[]>>;
};

/** Markup inside a line of text — a description, a label: emphasis and links, nothing that lays out. */
export const inlinePolicy: HtmlPolicy = {
  elements: ["b", "strong", "i", "em", "s", "mark", "br", "a"],
  attributes: { a: ["href"] },
  protocols: { "*": { href: ["http", "https", "mailto", "tel"] } },
};

/** Sanitize HTML for output — this is the security boundary. Idempotent. */
export function sanitizeHtml(html: string, use: HtmlPolicy): string {
  if (!html) return html;
  const seen = cached(use);
  const hit = seen.get(html);
  if (hit !== undefined) {
    seen.delete(html); // re-insert: map order = eviction order
    seen.set(html, hit);
    return hit;
  }
  const clean = sanitize(html, options(use));
  if (seen.size >= LIMIT) seen.delete(seen.keys().next().value!);
  seen.set(html, clean);
  return clean;
}

// Same text + same policy = same result, so cache per text instead of parsing per request.
const LIMIT = 500;
const results = new WeakMap<HtmlPolicy, Map<string, string>>();

function cached(use: HtmlPolicy) {
  return results.getOrInsertComputed(use, () => new Map());
}

// Converted once per policy, not per text.
const translated = new WeakMap<HtmlPolicy, sanitize.IOptions>();

function options(use: HtmlPolicy) {
  return translated.getOrInsertComputed(use, () => build(use));
}

/** The policy for sanitize-html. It has schemes per element, not per attribute, so they are merged. */
function build(use: HtmlPolicy): sanitize.IOptions {
  const byTag: Record<string, string[]> = {};
  for (const [element, rules] of Object.entries(use.protocols)) {
    if (element === "*") continue;
    byTag[element] = [...new Set(Object.values(rules).flat())];
  }
  return {
    allowedTags: use.elements,
    allowedAttributes: use.attributes,
    allowedSchemes: [...new Set(Object.values(use.protocols["*"] ?? {}).flat())],
    allowedSchemesByTag: byTag,
    ...(use.styles ? { allowedStyles: use.styles } : {}),
  };
}
