// @ts-types="@types/sanitize-html"
import sanitize from "sanitize-html";

import type { App } from "@qino/qino";

const DIM = /^\d+(?:\.\d+)?(?:px|%|r?em|vw|vh)$/;

/** Allowlist for CMS rich HTML, in the terms of the web Sanitizer API. Additions: `protocols` per
 *  element and attribute, and `styles` (an optional css-property allowlist). Raw editor HTML is
 *  stored; every non-edit output passes through here — this is the security boundary. */
export type Policy = {
  elements: string[];
  attributes: Record<string, string[]>;
  protocols: Record<string, Record<string, string[]>>;
  /** Allowed inline css properties per element. Missing element = all. */
  styles?: Record<string, Record<string, RegExp[]>>;
};

export const policy: Policy = {
  elements: [
    "h1", "h2", "h3", "h4", "h5", "h6", "p", "div", "span", "br", "hr", "blockquote", "pre", "code",
    "b", "strong", "i", "em", "u", "s", "sub", "sup", "a", "img", "figure", "figcaption",
    "table", "thead", "tbody", "tfoot", "tr", "td", "th", "ul", "ol", "li",
  ],
  attributes: {
    // `class` and `style` are presentation from the editor; restricting them is the editor's job.
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

// Site allowlist in the editor's syntax: `class title, a(href target)`, with protocols one level
// deeper. A bare group applies to all elements.
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

/** The app's policy: the default plus the site's settings. Settings are async but callers are sync,
 *  so the policy is cached and refreshed in the background — changes apply within `ttl` (dev: at once). */
const resolved = new WeakMap<App, { policy: Policy; at: number }>();

export function policyOf(app?: App): Policy {
  if (!app) return policy; // no app: default policy
  const ttl = app.dev ? 0 : 5 * 60 * 1000;
  const known = resolved.get(app);
  if (!known) resolved.set(app, { policy, at: performance.now() });
  else if (performance.now() - known.at <= ttl) return known.policy;
  else known.at = performance.now();
  refresh(app).catch(console.error); // for the next call
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
const results = new WeakMap<Policy, Map<string, string>>();

function cached(use: Policy): Map<string, string> {
  let seen = results.get(use);
  if (!seen) results.set(use, seen = new Map());
  return seen;
}

// Converted once per policy, not per text.
const translated = new WeakMap<Policy, sanitize.IOptions>();

function options(use: Policy): sanitize.IOptions {
  let ready = translated.get(use);
  if (!ready) translated.set(use, ready = build(use));
  return ready;
}

/** The policy for sanitize-html. It has schemes per element, not per attribute, so they are merged. */
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

/** The same policy in the editor's syntax (`class title, a(href target)`), so the editor only
 *  offers what output keeps. */
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
