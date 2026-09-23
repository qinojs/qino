/* html`` template builder, the same code on server and browser (SSR). Values are escaped unless
  * they are HtmlString; arrays are concatenated. */

const HEE = { "&": "&amp;", '"': "&quot;", "'": "&#039;", "<": "&lt;", ">": "&gt;" };
const SPECIAL = /[&"'<>]/;

/** Escape for HTML. Rarely needed — html`` escapes all values itself. */
export const hee = (str) => {
  const s = String(str ?? "");
  return SPECIAL.test(s) ? s.replace(/[&"'<>]/g, (c) => HEE[c]) : s; // fast path: nothing to escape
};

const ENTITY = /&(?:#(\d+)|#x([\da-f]+)|(amp|lt|gt|quot|apos|nbsp));/gi;
const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };

/** Reverse of hee(): decodes basic named and numeric entities. Plain text, no parsing; escape again
 *  before putting it back into markup. */
export const unhee = (str) => String(str ?? "").replace(ENTITY, (m, dec, hex, name) => {
  if (name) return NAMED[name.toLowerCase()];
  const n = dec ? Number(dec) : parseInt(hex, 16);
  return n <= 0x10ffff ? String.fromCodePoint(n) : m;
});

export class HtmlString {
  #html;
  constructor(html) { this.#html = String(html ?? ""); }
  get html() { return this.#html; }
  escaped() { return new HtmlString(hee(this.#html)); }
  toString() { return this.#html; }
}

// Arrays are concatenated: `<table>${rows.map((r) => html`<tr>…`)}</table>`. For a separator use
// html.join().
function htmlValue(v) {
  if (v instanceof HtmlString) return v.html;
  if (Array.isArray(v)) return v.map(htmlValue).join("");
  return hee(v);
}

// Like htmlValue, but awaits promises and renders values with an async html() method (e.g. a cms
// Node) recursively: html.async`<div>${node.cont("main")}</div>`.
async function htmlValueAsync(v) {
  v = await v;
  if (Array.isArray(v)) return (await Promise.all(v.map(htmlValueAsync))).join("");
  if (typeof v?.html === "function") return htmlValueAsync(v.html());
  return htmlValue(v);
}

function joinHtml(strings, parts) {
  return new HtmlString(strings.reduce((acc, str, i) => i < parts.length ? acc + str + parts[i] : acc + str, ""));
}

export function html(strings, ...values) {
  return joinHtml(strings, values.map(htmlValue));
}

html.async = async function (strings, ...values) {
  return joinHtml(strings, await Promise.all(values.map(htmlValueAsync)));
};

// Like sql.raw/sql.join: raw() trusts a string, join() combines fragments (strings escaped,
// HtmlString kept) into one HtmlString.
html.raw = (v) => new HtmlString(v);
html.join = (parts, separator = "") => new HtmlString(Array.from(parts, htmlValue).join(separator));
