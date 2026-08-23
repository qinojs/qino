/* Shared html`` template builder — the same code runs on the server and in the browser,
  * so a template can be rendered to a string here or there (SSR). Values are escaped
  * unless they are HtmlString; arrays render as their concatenated elements. */

const HEE = { "&": "&amp;", '"': "&quot;", "'": "&#039;", "<": "&lt;", ">": "&gt;" };

export function hee(str) {
  return String(str ?? "").replace(/[&"'<>]/g, (c) => HEE[c]);
}

export class HtmlString {
  #html;
  constructor(html) { this.#html = String(html ?? ""); }
  get html() { return this.#html; }
  escaped() { return new HtmlString(hee(this.#html)); }
  toString() { return this.#html; }
}

// An array renders as its concatenated elements, so a row list needs no wrapper:
// `<table>${rows.map((r) => html`<tr>…`)}</table>`. html.join() is for a separator.
function htmlValue(v) {
  if (v instanceof HtmlString) return v.html;
  if (Array.isArray(v)) return v.map(htmlValue).join("");
  return hee(v);
}

// Like htmlValue but awaits promises and renders "renderable" values (anything
// with an async html() method, e.g. a cms Node) recursively. Lets templates
// embed conts directly: html.async`<div>${node.cont("main")}</div>`.
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

// Mirrors sql.raw/sql.join: raw() trusts a string as-is, join() combines
// pre-built fragments (plain parts escaped, HtmlString kept) into one HtmlString.
html.raw = (v) => new HtmlString(v);
html.join = (parts, separator = "") => new HtmlString(Array.from(parts, htmlValue).join(separator));
