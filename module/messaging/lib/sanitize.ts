// @ts-types="@types/sanitize-html"
import sanitize from "sanitize-html";

import type { Profile } from "./format.ts";

/** Allowlist for message HTML shown in a page: content only, nothing active. Messages come from
 *  outside (inbound mail, api callers) and are untrusted. */
const POLICY: sanitize.IOptions = {
  allowedTags: [
    "h1", "h2", "h3", "h4", "h5", "h6", "p", "div", "span", "br", "hr", "blockquote", "pre", "code",
    "b", "strong", "i", "em", "u", "s", "a", "img", "table", "thead", "tbody", "tr", "td", "th", "ul", "ol", "li",
  ],
  allowedAttributes: { a: ["href"], img: ["src", "alt", "width", "height"], td: ["colspan", "rowspan"], th: ["colspan", "rowspan"] },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesByTag: { img: ["http", "https", "cid", "data"] },
};

/** Telegram's documented subset. Telegram rejects unknown tags, so everything else is dropped. */
const TELEGRAM: sanitize.IOptions = {
  allowedTags: ["b", "strong", "i", "em", "u", "ins", "s", "strike", "del", "a", "code", "pre", "blockquote", "tg-spoiler"],
  allowedAttributes: { a: ["href"], code: ["class"], blockquote: ["expandable"] },
  allowedSchemes: ["http", "https", "mailto", "tel"],
};

/** Sanitize message HTML for the target that has to render it. Idempotent. */
export function sanitizeHtml(html: string, profile: Profile = "html"): string {
  return html ? sanitize(html, profile === "telegram" ? TELEGRAM : POLICY) : html;
}
