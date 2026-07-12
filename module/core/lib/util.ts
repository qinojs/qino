import { sql, type Sql } from "../../../deps.ts";

/** Single source of truth for CDN roots (version pin). */
export const u2Root = "https://cdn.jsdelivr.net/gh/u2ui/u2@1.4.0/";
export const itemRoot = "https://jsr.io/@nuxodin/item/0.5.12/";

export function ensureSlash(v: string) { return v.endsWith("/") ? v : v + "/"; }

/** Cookie name prefix. `__Host-` requires Path=/, so fall back to `__Secure-` on sub-path mounts. */
export function cookiePrefix(https: boolean, appURL: string): string {
  if (!https) return "";
  return appURL === "/" ? "__Host-" : "__Secure-";
}

/** Safe Content-Disposition value: ASCII fallback + RFC 5987 filename* (no header injection). */
export function contentDisposition(type: "inline" | "attachment", name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** Client IP. Trusts `hops` proxies from the right of x-forwarded-for; 0 = peer addr only (XFF ignored, unspoofable). */
export function clientIp(request: Request, peerAddr: string, hops = 0): string {
  if (hops <= 0) return peerAddr;
  const xff = request.headers.get("x-forwarded-for")?.split(",").map(s => s.trim()).filter(Boolean) ?? [];
  return xff[xff.length - hops] ?? peerAddr;
}

export const unixTime = (): number => Math.floor(Date.now() / 1000);

/** Render a timestamp (unix seconds, numeric string, Date or date string) as a relative <u2-time>; epoch/invalid → "-". */
export function u2time(t: unknown): string {
  if (t == null || t === "") return "-";
  const d = t instanceof Date ? t
    : Number.isFinite(Number(t)) ? new Date(Number(t) * 1000)
    : new Date(String(t));
  if (Number.isNaN(d.getTime()) || d.getTime() === 0) return "-";
  const iso = d.toISOString();
  return `<u2-time datetime="${iso}" type=relative minute>${iso.slice(0, 16).replace("T", " ")}</u2-time>`;
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

// Mirrors sql.raw/sql.join: raw() trusts a string as-is, join() combines
// pre-built fragments (plain parts escaped, HtmlString kept) into one HtmlString.
html.raw = (v: unknown): HtmlString => new HtmlString(v);
html.join = (parts: Iterable<unknown>, separator = ""): HtmlString =>
  new HtmlString(Array.from(parts, htmlValue).join(separator));

export function uid(length?: number): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const full = btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  return length ? full.slice(0, length) : full;
}

/* Control flow signals */
export class Output extends Error {
  body: BodyInit | undefined;
  status: number;
  headers: Record<string, string>;
  isJson: boolean;
  constructor(body?: unknown, { status = 200, headers = {} }: { status?: number; headers?: Record<string, string> } = {}) {
    super("output");
    this.isJson = body !== undefined && typeof body === "object" && !(body instanceof Uint8Array) && !(body instanceof ReadableStream);
    this.body = this.isJson ? JSON.stringify(body) : body as BodyInit;
    this.status = status;
    this.headers = headers;
  }
  /** Response headers for this signal; JSON content-type as default, explicit headers win. */
  buildHeaders(): Headers {
    const headers = new Headers(this.headers);
    if (this.isJson && !headers.has("Content-Type")) headers.set("Content-Type", "application/json; charset=UTF-8");
    return headers;
  }
  toResponse(): Response {
    return new Response(this.body, { status: this.status, headers: this.buildHeaders() });
  }
}
export class Redirect extends Output {
  constructor(location: string, status = 302) { super(undefined, { status, headers: { Location: location } }); }
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
): { where: Sql; order: Sql } {
  const searches = (search ?? "").trim().split(/\s+/).slice(0, 4).filter(Boolean);
  if (!searches.length || !fields.length) {
    return { where: sql.raw("true"), order: sql.raw("1") };
  }
  // Escape LIKE wildcards in user input; '!' is a neutral escape char in every dialect's string literals.
  const esc = (s: string) => s.replace(/[!%_]/g, "!$&");
  const wheres: Sql[] = [];
  const orders: Sql[] = [];
  for (const s of searches) {
    wheres.push(sql`(${sql.join(fields.map((f) => sql`${sql.id(f)} LIKE ${"%" + esc(s) + "%"} ESCAPE '!'`), " OR ")})`);
    for (const f of fields) orders.push(sql`${sql.id(f)} LIKE ${esc(s) + "%"} ESCAPE '!' DESC`);
  }
  return { where: sql.join(wheres, " AND "), order: sql.join(orders, ", ") };
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
