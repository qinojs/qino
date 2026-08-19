import { sql } from "../deps.ts";

import type { Sql } from "../deps.ts";
import type { Manifest } from "./ModuleManager.ts";

/** Single source of truth for CDN roots (version pin). */
export const u2Root = "https://cdn.jsdelivr.net/gh/u2ui/u2@1.4.6/";
// jsr.io serves packages to Deno, not to browsers (no CORS, text/html) — the git tag behind the
// same pin does. Keeps the browser working without uncdn proxying it.
export const itemRoot = "https://cdn.jsdelivr.net/gh/nuxodin/item.js@v0.6.10/"; // pin lives in deno.json; a test keeps this in step

export function ensureSlash(v: string) { return v.endsWith("/") ? v : v + "/"; }

const fileCache = new Map<string, { is: boolean; t: number }>(); // absolute paths — no tenant mixing

/** Does this file exist? Cached for 5 min, `dev` always looks. */
export async function isFile(path: string, dev = false): Promise<boolean> {
  const hit = fileCache.get(path);
  if (!dev && hit && performance.now() - hit.t < 300_000) return hit.is;
  const is = await Deno.stat(path).then((s) => s.isFile).catch(() => false);
  fileCache.set(path, { is, t: performance.now() });
  return is;
}

/** Cookie name prefix. `__Host-` requires Path=/, so fall back to `__Secure-` on sub-path mounts. */
export function cookiePrefix(https: boolean, appUrl: string): string {
  if (!https) return "";
  return appUrl === "/" ? "__Host-" : "__Secure-";
}

/** Header builders (like sql.id/html.raw): each returns a [name, value] tuple
 *  for headers.set(...) / .append(...) or HeadersInit arrays. */
interface HeaderBuilders {
  contentDisposition(type: "inline" | "attachment", name: string): [string, string];
  setCookie(name: string, value: string, appUrl: string, https: boolean, maxAge?: number): [string, string];
}

export const header: HeaderBuilders = {
  /** Safe Content-Disposition: ASCII fallback + RFC 5987 filename* (no header injection). */
  contentDisposition(type: "inline" | "attachment", name: string): [string, string] {
    const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
    return ["Content-Disposition", `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`];
  },
  /** Secure Set-Cookie (HttpOnly, SameSite=Lax, prefix). Optional Max-Age (seconds) for persistent cookies. */
  setCookie(name: string, value: string, appUrl: string, https: boolean, maxAge?: number): [string, string] {
    const fullName = cookiePrefix(https, appUrl) + name;
    const parts = [`${fullName}=${value}`, `Path=${appUrl}`];
    if (maxAge != null) parts.push(`Max-Age=${maxAge}`);
    parts.push("HttpOnly;SameSite=Lax");
    if (https) parts.push("Secure");
    return ["Set-Cookie", parts.join("; ")];
  },
};

/** Client IP. Trusts `hops` proxies from the right of x-forwarded-for; 0 = peer addr only (XFF ignored, unspoofable). */
export function clientIp(request: Request, peerAddr: string, hops = 0): string {
  if (hops <= 0) return peerAddr;
  const xff = request.headers.get("x-forwarded-for")?.split(",").map(s => s.trim()).filter(Boolean) ?? [];
  return xff[xff.length - hops] ?? peerAddr;
}

export const unixTime = (): number => Math.floor(Date.now() / 1000);

/** To boolean. Settings are stored as text, so "false", "0" and "" are false. */
export const isOn = (v: unknown): boolean => !!v && v !== "0" && v !== "false";

/** No keys. Unlike Object.keys(o).length it builds no array to answer that. */
export function isEmptyObject(o: object): boolean {
  for (const _ in o) return false;
  return true;
}

/** The message of whatever was thrown — an Error or anything else. */
export const errMsg = (e: unknown): string => e instanceof Error ? e.message : String(e);

/** HTML utilities */
const HEE: Record<string, string> = {"&":"&amp;",'"':"&quot;","'":"&#039;","<":"&lt;",">":"&gt;"};
export function hee(str: unknown): string {
  return String(str ?? "").replace(/[&"'<>]/g, c => HEE[c]);
}

export class HtmlString {
  #html: string;
  constructor(html: unknown) { this.#html = String(html ?? ""); }
  get html(): string { return this.#html; }
  escaped(): HtmlString { return new HtmlString(hee(this.#html)); }
  toString(): string { return this.#html; }
}

// An array renders as its concatenated elements, so a row list needs no wrapper:
// `<table>${rows.map((r) => html`<tr>…`)}</table>`. html.join() is for a separator.
function htmlValue(v: unknown): string {
  if (v instanceof HtmlString) return v.html;
  if (Array.isArray(v)) return v.map(htmlValue).join("");
  return hee(v);
}

// Like htmlValue but awaits promises and renders "renderable" values (anything
// with an async html() method, e.g. a cms Node) recursively. Lets templates
// embed conts directly: html.async`<div>${node.cont("main")}</div>`.
async function htmlValueAsync(v: unknown): Promise<string> {
  v = await v;
  if (Array.isArray(v)) return (await Promise.all(v.map(htmlValueAsync))).join("");
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

/** An SVG `<use>` for a module-declared icon. */
export function moduleIcon(mod: { manifest: Manifest; modUrl: string } | undefined, fallback?: string): HtmlString | undefined {
  const file = "pub/module.svg";
  const url = mod?.manifest.files?.includes(file) ? mod.modUrl + file : fallback;
  if (url) return html`<use href="${url}#main" />`;
}

/** base64url (RFC 4648) — no padding, URL-safe alphabet. */
export const b64url = (bytes: Uint8Array): string => bytes.toBase64({ alphabet: "base64url", omitPadding: true });
export const unb64url = (str: string): Uint8Array<ArrayBuffer> => Uint8Array.fromBase64(str, { alphabet: "base64url" });

/** n random bytes as base64url. */
export const randB64 = (n: number): string => b64url(crypto.getRandomValues(new Uint8Array(n)));

const digest = async (str: string): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str)));

/** SHA-256 of a string as base64 — 44 chars. What CSP hash-sources and SRI `integrity` expect. */
export const sha256b64 = async (str: string): Promise<string> => (await digest(str)).toBase64();

/** SHA-256 as base64url — 43 chars, safe as a column key or URL parameter. Required for PKCE. */
export const sha256b64url = async (str: string): Promise<string> => b64url(await digest(str));

export const uid = (length?: number): string => randB64(16).slice(0, length);

/* Control flow signals */
export class Output extends Error {
  body: BodyInit | undefined;
  status: number;
  headers: HeadersInit;
  isJson: boolean;
  constructor(body?: unknown, { status = 200, headers = {} }: { status?: number; headers?: HeadersInit } = {}) {
    super("output");
    const isBody = body instanceof ReadableStream || body instanceof Blob || body instanceof FormData ||
      body instanceof URLSearchParams || body instanceof ArrayBuffer || ArrayBuffer.isView(body);
    this.isJson = body !== undefined && typeof body === "object" && !isBody;
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
  constructor(location: string, status = 302, headers: Record<string, string> = {}) { super(undefined, { status, headers: { ...headers, Location: location } }); }
}

// urlize
const TRANSLIT: Record<string, string> = {
  ä: "ae", ö: "oe", ü: "ue", Ä: "ae", Ö: "oe", Ü: "ue",
  ß: "ss", æ: "ae", œ: "oe", þ: "th", ð: "dh", "&": "and", "&amp;": "and",
};
// longest first: "&amp;" must win over "&"
const TRANSLIT_RE = new RegExp(
  Object.keys(TRANSLIT).sort((a, b) => b.length - a.length).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
export function urlize(str: string): string {
  return str
    .replace(TRANSLIT_RE, m => TRANSLIT[m])
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Tokenized LIKE search: every word must match a `like` column (case-insensitive, wildcards
 *  escaped); `exact` columns match the whole input instead (ids, emails). `order` ranks exact
 *  hits before word prefixes. Both fragments are neutral on empty input, so call sites need no
 *  branching. Qualified names ("m.subject") are supported. */
export function sqlSearch(input: string, like: string[], opt: { exact?: string[] } = {}): { where: Sql; order: Sql } {
  const trimmed = (input ?? "").trim();
  const words = trimmed.toLowerCase().split(/\s+/).slice(0, 4).filter(Boolean);
  const exact = opt.exact ?? [];
  if (!words.length || !(like.length + exact.length)) return { where: sql`${true}`, order: sql.raw("NULL") };
  const id = (name: string) => sql.join(name.split(".").map(sql.id), ".");
  // '!' is a neutral escape char in every dialect's string literals.
  const esc = (s: string) => s.replace(/[!%_]/g, "!$&");
  const low = (f: string) => sql`LOWER(${id(f)})`;

  const ors = exact.map(f => sql`${id(f)} = ${trimmed}`);
  if (like.length) ors.unshift(sql.join(words.map(w =>
    sql`(${sql.join(like.map(f => sql`${low(f)} LIKE ${"%" + esc(w) + "%"} ESCAPE '!'`), " OR ")})`), " AND "));

  const orders = [
    ...exact.map(f => sql`${id(f)} = ${trimmed} DESC`),
    ...like.map(f => sql`${low(f)} = ${trimmed.toLowerCase()} DESC`),
    ...words.flatMap(w => like.map(f => sql`${low(f)} LIKE ${esc(w) + "%"} ESCAPE '!' DESC`)),
  ];
  return { where: sql`(${sql.join(ors, " OR ")})`, order: sql.join(orders, ", ") };
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

/** Apply schema defaults and type coercion on item.js get event. */
// tobi: Schema defaults apply only to existing items. Do we need to act on this?
// deno-lint-ignore no-explicit-any
function itemGetIn(e: any): void {
  const schema = e.target.schema;
  if (e.value == null && schema?.default !== undefined) e.value = schema.default;
  if (e.value == null || typeof e.value === 'object' || !schema?.type) return;

  const num = Number(e.value);
  if ((schema.type === 'integer' || schema.type === 'number') && !Number.isNaN(num))
    e.value = num;
  else if (schema.type === 'boolean')
    e.value = typeof e.value === 'string' ? !['false', '0', ''].includes(e.value) : !!e.value;
}

/** Enable schema-driven defaults on an item.js Item (attach listener for getIn events). */
// deno-lint-ignore no-explicit-any
export function enableItemSchemaDefaults(item: any): void {
  item.addEventListener('getIn', itemGetIn);
}
