// @ts-types="@types/sanitize-html"
import sanitize from "sanitize-html";

import type { Profile } from "./format.ts";

/** Allowlist for message HTML on its way into a page: what a message can say, nothing that acts.
 *  Messages come from outside — an inbound mail, an api caller — so nothing here may be trusted. */
const POLICY: sanitize.IOptions = {
  allowedTags: [
    "h1", "h2", "h3", "h4", "h5", "h6", "p", "div", "span", "br", "hr", "blockquote", "pre", "code",
    "b", "strong", "i", "em", "u", "s", "a", "img", "table", "thead", "tbody", "tr", "td", "th", "ul", "ol", "li",
  ],
  allowedAttributes: { a: ["href"], img: ["src", "alt", "width", "height"], td: ["colspan", "rowspan"], th: ["colspan", "rowspan"] },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesByTag: { img: ["http", "https", "cid", "data"] },
};

/** Telegram's documented subset. Not a matter of taste: an unknown tag is refused, not ignored,
 *  and the message never goes out — so what a channel cannot say is dropped, never sent. */
const TELEGRAM: sanitize.IOptions = {
  allowedTags: ["b", "strong", "i", "em", "u", "ins", "s", "strike", "del", "a", "code", "pre", "blockquote", "tg-spoiler"],
  allowedAttributes: { a: ["href"], code: ["class"], blockquote: ["expandable"] },
  allowedSchemes: ["http", "https", "mailto", "tel"],
};

/** Sanitize message HTML for the target that has to render it. Idempotent. */
export function sanitizeHtml(html: string, profile: Profile = "html"): string {
  return html ? sanitize(html, profile === "telegram" ? TELEGRAM : POLICY) : html;
}
