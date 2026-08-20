// @ts-types="@types/sanitize-html"
import sanitize from "sanitize-html";

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

/** Sanitize message HTML for output. Idempotent. */
export function sanitizeHtml(html: string): string {
  return html ? sanitize(html, POLICY) : html;
}
