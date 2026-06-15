
/** Single source of truth for the u2 CDN root (version pin). */
export const u2Root = "https://cdn.jsdelivr.net/gh/u2ui/u2@1.3.18/";

export function ensureSlash(v: string) { return v.endsWith("/") ? v : v + "/"; }

/** Safe Content-Disposition value: ASCII fallback + RFC 5987 filename* (no header injection). */
export function contentDisposition(type: "inline" | "attachment", name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Client IP from x-forwarded-for (first hop). Only trustworthy behind a trusted proxy. */
export function clientIp(req: { header(name: string): string | undefined }): string {
  return req.header("x-forwarded-for")?.split(",").shift()?.trim() ?? "";
}

/** HTML utilities */
export function hee(str: unknown): string {
  return String(str ?? "").replace(/[&"'<>]/g, c => ({"&":"&amp;",'"':"&quot;","'":"&#039;","<":"&lt;",">":"&gt;"})[c]!);
}

export class HtmlString {
  #html: string;
  constructor(html: unknown) { this.#html = String(html ?? ""); }
  get html(): string { return this.#html; }
  escaped(): HtmlString { return new HtmlString(hee(this.#html)); }
  toString(): string { return this.#html; }
}

function htmlValue(v: unknown): string {
  if (v instanceof HtmlString) return v.html;
  if (v != null && typeof v === "object" && "html" in (v as object)) return (v as { html: string }).html;
  return hee(v);
}

// Like htmlValue but awaits promises and renders "renderable" values (anything
// with an async html() method, e.g. a cms Node) recursively. Lets templates
// embed conts directly: html.async`<div>${node.cont("main")}</div>`.
async function htmlValueAsync(v: unknown): Promise<string> {
  v = await v;
  const r = v as { html?: unknown };
  if (typeof r?.html === "function") return htmlValueAsync((r.html as () => unknown)());
  return htmlValue(v);
}

function joinHtml(strings: TemplateStringsArray, parts: string[]): HtmlString {
  return new HtmlString(strings.reduce((acc, str, i) => i < parts.length ? acc + str + parts[i] : acc + str, ""));
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): HtmlString {
  return joinHtml(strings, values.map(htmlValue));
}

html.async = async function(strings: TemplateStringsArray, ...values: unknown[]): Promise<HtmlString> {
  return joinHtml(strings, await Promise.all(values.map(htmlValueAsync)));
};

export function uid(length?: number): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const full = btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  return length ? full.slice(0, length) : full;
}

/* Control flow signals */
export class Output extends Error {
  body: unknown;
  status: number;
  headers: Record<string, string>;
  isJson: boolean;
  constructor(body?: unknown, { status = 200, headers = {} }: { status?: number; headers?: Record<string, string> } = {}) {
    super("output");
    this.isJson = body !== undefined && typeof body === "object" && !(body instanceof Uint8Array);
    this.body = this.isJson ? JSON.stringify(body) : body;
    this.status = status;
    this.headers = headers;
  }
}
export class Redirect extends Error {
  location: string;
  status: number;
  constructor(location: string, status = 302) { super("redirect"); this.location = location; this.status = status; }
}

// urlize
const TRANSLIT: Record<string, string> = {
  ä: "ae", ö: "oe", ü: "ue", Ä: "ae", Ö: "oe", Ü: "ue",
  ß: "ss", æ: "ae", œ: "oe", þ: "th", ð: "dh", "&": "and", "&amp;": "and",
};
const TRANSLIT_RE = new RegExp(Object.keys(TRANSLIT).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
export function urlize(str: string): string {
  return str
    .replace(TRANSLIT_RE, m => TRANSLIT[m])
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function sqlSearchHelper(
  search: string,
  fields: string[],
): { where: string; order: string; whereParams: string[]; orderParams: string[] } {
  const searches = (search ?? "").trim().split(/\s+/).slice(0, 4).filter(Boolean);
  if (!searches.length || !fields.length) {
    return { where: "1", order: "1", whereParams: [], orderParams: [] };
  }
  const wheres: string[] = [];
  const orders: string[] = [];
  const whereParams: string[] = [];
  const orderParams: string[] = [];
  for (const s of searches) {
    wheres.push("(" + fields.map((f) => `${f} LIKE ?`).join(" OR ") + ")");
    for (const _f of fields) whereParams.push(`%${s}%`);
  }
  for (const s of searches) {
    for (const f of fields) { orders.push(`${f} LIKE ? DESC`); orderParams.push(`${s}%`); }
  }
  return { where: wheres.join(" AND "), order: orders.join(", "), whereParams, orderParams };
}

/**
 * Recursively materializes an item.js item into a plain object.
 * read() only loads one level — itemReadDeep forces read() on every level and
 * assembles the whole subtree. Unlike .get() (synchronous, returns only
 * already-loaded values), itemReadDeep also fetches lazy/async subtrees.
 */
// deno-lint-ignore no-explicit-any
export async function itemReadDeep(item: any): Promise<unknown> {
  await item.read();
  if (item.keys?.length) {
    const data: Record<string, unknown> = {};
    for (const key of item.keys) data[key] = await itemReadDeep(item.item(key));
    return data;
  }
  return item.get() ?? null;
}
