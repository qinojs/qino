// @ts-types="@types/sanitize-html"
import sanitize from "sanitize-html";

const DIM = /^\d+(?:\.\d+)?(?:px|%|r?em|vw|vh)$/;

/** Allowlist policy for CMS rich-HTML. Storage keeps raw editor HTML; every non-edit output passes through here. */
const POLICY: sanitize.IOptions = {
    allowedTags: [
        "h1", "h2", "h3", "h4", "h5", "h6", "p", "div", "span", "br", "hr", "blockquote", "pre", "code",
        "b", "strong", "i", "em", "u", "s", "sub", "sup", "a", "img", "figure", "figcaption",
        "table", "thead", "tbody", "tfoot", "tr", "td", "th", "ul", "ol", "li",
    ],
    allowedAttributes: {
        a: ["href", "target"],
        img: ["src", "alt", "width", "height", "loading", "style"],
        td: ["colspan", "rowspan"],
        th: ["colspan", "rowspan"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel", "cmspid"], // cmspid:// stays unresolved in edit mode
    allowedSchemesByTag: { img: ["http", "https", "data"] },
    allowedStyles: {
        img: { // the inline editor sizes images via style (see cms.frontend.2 dropPasteHelper)
            width: [DIM],
            height: [/^auto$/, DIM],
            "max-width": [DIM],
            "--shape-outside-url": [/^url\(["']?[^"'()\s]+["']?\)$/],
        },
    },
};

/** Sanitize stored rich-HTML for output. Idempotent. */
export function sanitizeHtml(html: string): string {
    if (!html) return html;
    return sanitize(html, POLICY);
}
