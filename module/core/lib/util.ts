import * as nodePath from "node:path";
import type { App } from "../server.ts";
import type { RequestContext } from "./RequestContext.ts";

/* path / url utilities */
export function appRequestUriToLocalPath(appRequestUri: string, app: App): string | null {
  const matchM = appRequestUri.match(/^m\/([^/]+)\/pub\/(.*)/);
  if (matchM) {
    const mod = app.modules.get(matchM[1]);
    const base = mod?.dir ?? (app.appPATH + "m/" + matchM[1] + "/");
    return publicPath(base, matchM[2]);
  }
  const matchQg = appRequestUri.match(/^qg\/([^/]+)\/pub\/(.*)/);
  if (matchQg) {
    return publicPath(app.appPATH + "qg/" + matchQg[1] + "/", matchQg[2]);
  }
  return null;
}

function publicPath(root: string, file: string): string | null {
  if (!file || file.includes("\0")) return null;
  const pub = nodePath.resolve(root, "pub"), target = nodePath.resolve(pub, file);
  const rel = nodePath.relative(pub, target);
  return rel && rel !== ".." && !rel.startsWith(".." + nodePath.sep) ? target : null;
}

export function urlToLocalPath(url: string, ctx: RequestContext): string | null {
  try {
    const u = new URL(url);
    if (u.protocol === "file:") return u.pathname;
    const appRequestUri = decodeURIComponent(u.pathname.slice(ctx.appURL.length));
    return appRequestUriToLocalPath(appRequestUri, ctx.app);
  } catch { /* not a URL */ }
  return null;
}

export function assertAllowedPath(file: string, app: App): void {
  if (!file || file.includes("\0")) throw new OutputError("invalid path");
  const resolved = nodePath.resolve(file);
  if (resolved !== nodePath.normalize(file) && resolved !== file) throw new OutputError("invalid path");
  const roots: string[] = [nodePath.resolve(app.appPATH)];
  for (const mod of Object.values(app.modules.all())) {
    if (mod.dir) roots.push(nodePath.resolve(mod.dir));
  }
  if (!roots.some(root => resolved.startsWith(root + nodePath.sep))) throw new OutputError("invalid path");
}

export function ensureSlash(v: string) { return v.endsWith("/") ? v : v + "/"; }

/** HTML utilities */
export function hee(str: unknown): string {
  return String(str ?? "").replace(/[&"'<>]/g, c => ({"&":"&amp;",'"':"&quot;","'":"&#039;","<":"&lt;",">":"&gt;"})[c]!);
}

export class HtmlString {
  #html: string;
  constructor(html: unknown) { this.#html = String(html ?? ""); }
  get html(): string { return this.#html; }
  escaped() { return new HtmlString(hee(this.#html)); }
  toString() { return this.#html; }
}

function htmlValue(v: unknown): string {
  if (v instanceof HtmlString) return v.html;
  if (v != null && typeof v === "object" && "html" in (v as object)) return (v as { html: string }).html;
  return hee(v);
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): HtmlString {
  return new HtmlString(strings.reduce((acc, str, i) => {
    return i < values.length ? acc + str + htmlValue(values[i]) : acc + str;
  }, ""));
}

html.async = async function(strings: TemplateStringsArray, ...values: unknown[]): Promise<HtmlString> {
  const resolved = await Promise.all(values.map(v => v));
  return new HtmlString(strings.reduce((acc, str, i) => {
    return i < resolved.length ? acc + str + htmlValue(resolved[i]) : acc + str;
  }, ""));
};

export function uid(length?: number): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const full = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return length ? full.slice(0, length) : full;
}

/* Error classes for control flow */
export class AnswerError extends Error { constructor(public data: Record<string, any>, public status = 200) { super("Answer"); } }
export class RedirectError extends Error { constructor() { super("redirect"); } }
export class OutputError extends Error { constructor(public body: unknown) { super("output"); } }
export class OutputDoneError extends Error { constructor() { super("output done"); } }

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
    for (const f of fields) whereParams.push(`%${s}%`);
  }
  for (const s of searches) {
    for (const f of fields) { orders.push(`${f} LIKE ? DESC`); orderParams.push(`${s}%`); }
  }
  return { where: wheres.join(" AND "), order: orders.join(", "), whereParams, orderParams };
}
