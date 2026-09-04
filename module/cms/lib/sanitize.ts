// @ts-types="@types/sanitize-html"
import sanitize from "sanitize-html";

import type { App } from "@qino/qino";

const DIM = /^\d+(?:\.\d+)?(?:px|%|r?em|vw|vh)$/;

/** Allowlist policy for CMS rich-HTML, written in the vocabulary of the web Sanitizer API so the
 *  editor, the browser and this filter name the same things alike. Two additions the api has no
 *  answer for: `protocols` per element and attribute, and `styles` — a css-property allowlist for
 *  sites that want one. Storage keeps raw editor HTML; every non-edit output passes through here,
 *  which makes this policy the security decision, not the one the editor works with. */
export type Policy = {
  elements: string[];
  attributes: Record<string, string[]>;
  protocols: Record<string, Record<string, string[]>>;
  /** Per element, which css properties an inline style may carry. Absent element = all of them. */
  styles?: Record<string, Record<string, RegExp[]>>;
};

export const policy: Policy = {
  elements: [
    "h1", "h2", "h3", "h4", "h5", "h6", "p", "div", "span", "br", "hr", "blockquote", "pre", "code",
    "b", "strong", "i", "em", "u", "s", "sub", "sup", "a", "img", "figure", "figcaption",
    "table", "thead", "tbody", "tfoot", "tr", "td", "th", "ul", "ol", "li",
  ],
  attributes: {
    // `class` carries the content classes an editor declares, `style` what it set on a block: both
    // are presentation, and taking them away is the editor's business, not this boundary's.
    "*": ["class", "dir", "lang", "style", "title"],
    a: ["href", "target"],
    img: ["src", "alt", "width", "height", "loading"],
    td: ["colspan", "rowspan"],
    th: ["colspan", "rowspan"],
  },
  protocols: {
    "*": { href: ["http", "https", "mailto", "tel", "cmspid"] }, // cmspid:// stays unresolved in edit mode
    img: { src: ["http", "https", "data"] },
  },
};

// What a site allows, in the grammar the editor reads: `class title, a(href target)`, and one level
// deeper for protocols. A bare group applies to every element.
function parse(declared: string, deep = false): Record<string, unknown> | null {
  if (!declared.trim()) return null;
  const result: Record<string, unknown> = {};
  for (const group of declared.split(",")) {
    const match = group.trim().match(/^([a-z][a-z\d-]*)\s*\((.*)\)$/s);
    const inner = (match ? match[2] : group).trim();
    if (!deep) result[match ? match[1] : "*"] = inner.split(/\s+/).filter(Boolean);
    else {
      const [attribute, ...rest] = inner.split(":");
      result[match ? match[1] : "*"] = { [attribute.trim()]: rest.join(":").split(/\s+/).filter(Boolean) };
    }
  }
  return result;
}

/** The policy this app runs with: the framework's, with whatever the site declared over it. Settings
 *  are read asynchronously while every consumer here is synchronous, so a resolved policy is kept and
 *  refreshed in the background — a change shows up within `ttl`, and at once while developing. */
const resolved = new WeakMap<App, { policy: Policy; at: number }>();

export function policyOf(app?: App): Policy {
  if (!app) return policy; // no app, no site settings — the shipped policy is the answer
  const ttl = app.dev ? 0 : 5 * 60 * 1000;
  const known = resolved.get(app);
  if (!known) resolved.set(app, { policy, at: performance.now() });
  else if (performance.now() - known.at <= ttl) return known.policy;
  else known.at = performance.now();
  refresh(app).catch(console.error); // the answer is for the next call, not this one
  return resolved.get(app)!.policy;
}

async function refresh(app: App): Promise<void> {
  const site = app.settings.cms.sanitize;
  const [elements, attributes, protocols] = await Promise.all([site.elements, site.attributes, site.protocols]);
  const use: Policy = { ...policy };
  const list = String(elements ?? "").split(/[\s,]+/).filter(Boolean);
  const attributeGroups = parse(String(attributes ?? ""));
  const protocolGroups = parse(String(protocols ?? ""), true);
  if (list.length) use.elements = list;
  if (attributeGroups) use.attributes = attributeGroups as Policy["attributes"];
  if (protocolGroups) use.protocols = protocolGroups as Policy["protocols"];
  resolved.set(app, { policy: use, at: performance.now() });
}

/** Sanitize stored rich-HTML for output. Idempotent. */
export function sanitizeHtml(html: string, use: Policy = policy): string {
  if (!html) return html;
  const seen = cached(use);
  const hit = seen.get(html);
  if (hit !== undefined) {
    seen.delete(html); // re-insert: the map's own order is the recency this evicts by
    seen.set(html, hit);
    return hit;
  }
  const clean = sanitize(html, options(use));
  if (seen.size >= LIMIT) seen.delete(seen.keys().next().value!);
  seen.set(html, clean);
  return clean;
}

// The same text sanitized with the same policy is the same answer, and a page renders the same texts
// for every visitor — so the parse happens once per text rather than once per request.
const LIMIT = 500;
const results = new WeakMap<Policy, Map<string, string>>();

function cached(use: Policy): Map<string, string> {
  let seen = results.get(use);
  if (!seen) results.set(use, seen = new Map());
  return seen;
}

// Every output passes through here, so the translation happens once per policy, not once per text.
const translated = new WeakMap<Policy, sanitize.IOptions>();

function options(use: Policy): sanitize.IOptions {
  let ready = translated.get(use);
  if (!ready) translated.set(use, ready = build(use));
  return ready;
}

/** The policy in sanitize-html's own shape. Its schemes are per element, not per attribute, so the
 *  protocols of one element are merged. */
function build(use: Policy): sanitize.IOptions {
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

/** The same policy for the editor, in the css the rte reads: `class title, a(href target)` for the
 *  element-specific lists, the bare group applying to every element. One list decides what may be
 *  written and what survives being served, so the editor stops offering what output would drop. */
export function policyCss(use: Policy = policy): string {
  const group = (element: string, names: string[]) =>
    element === "*" ? names.join(" ") : `${element}(${names.join(" ")})`;
  const attributes = Object.entries(use.attributes).map(([element, names]) => group(element, names));
  const protocols = Object.entries(use.protocols).flatMap(([element, rules]) =>
    Object.entries(rules).map(([attribute, schemes]) => group(element, [`${attribute}:`, ...schemes])));
  return `:root{--u2-rte-elements:${use.elements.join(" ")};` +
    `--u2-rte-attributes:${attributes.join(", ")};--u2-rte-protocols:${protocols.join(", ")}}`;
}

/** The image sizing the inline editor writes, for a site that wants to allow nothing else. */
export const imageStyles = {
  img: {
    width: [DIM],
    height: [/^auto$/, DIM],
    "max-width": [DIM],
    "--shape-outside-url": [/^url\(["']?[^"'()\s]+["']?\)$/],
  },
};
