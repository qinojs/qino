/**
 * Thin wrapper around a Web-standard `Request` — the core's only request type,
 * keeping it framework-free. Body reads are memoized so it can be parsed twice
 * (RequestContext + apt handler) without "body already used".
 */
export class Req {
  readonly raw: Request;
  readonly url: string;
  readonly method: string;
  /** Direct TCP peer address (from the runtime), the only unspoofable IP source. */
  readonly peerAddr: string;
  /** performance.now() when the request entered the pipeline. */
  readonly time: number;
  readonly #url: URL;
  #json: Promise<unknown> | undefined;
  #form: Promise<FormData> | undefined;
  #cookies: Record<string, string> | undefined;

  constructor(raw: Request, peerAddr = "", time = performance.now()) {
    this.raw = raw;
    this.url = raw.url;
    this.method = raw.method;
    this.peerAddr = peerAddr;
    this.time = time;
    this.#url = new URL(raw.url);
  }

  get path(): string { return this.#url.pathname; }

  header(name: string): string | undefined {
    return this.raw.headers.get(name) ?? undefined;
  }

  /** All query params (first value each) or, with a key, that single value. */
  query(): Record<string, string>;
  query(key: string): string | undefined;
  query(key?: string): Record<string, string> | string | undefined {
    if (key !== undefined) return this.#url.searchParams.get(key) ?? undefined;
    const out: Record<string, string> = Object.create(null);
    for (const [k, v] of this.#url.searchParams) if (!(k in out)) out[k] = v;
    return out;
  }

  /** All query params as arrays or, with a key, that param's values. */
  queries(): Record<string, string[]>;
  queries(key: string): string[];
  queries(key?: string): Record<string, string[]> | string[] {
    if (key !== undefined) return this.#url.searchParams.getAll(key);
    const out: Record<string, string[]> = Object.create(null);
    for (const k of this.#url.searchParams.keys()) out[k] ??= this.#url.searchParams.getAll(k);
    return out;
  }

  json(): Promise<unknown> {
    return this.#json ??= this.raw.clone().json();
  }

  /** Form/multipart body as a flat record; File values are kept as `File`, repeated keys become arrays. */
  async parseBody(): Promise<Record<string, unknown>> {
    return groupFormData(await (this.#form ??= this.raw.clone().formData()));
  }

  cookies(): Record<string, string> {
    return this.#cookies ??= parseCookies(this.header("cookie"));
  }

  cookie(name: string): string | undefined {
    return this.cookies()[name];
  }
}

/** FormData as a flat record; repeated keys become arrays. */
export function groupFormData(form: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = Object.create(null);
  for (const [k, v] of form) {
    const cur = out[k];
    if (cur === undefined) out[k] = v;
    else if (Array.isArray(cur)) cur.push(v);
    else out[k] = [cur, v];
  }
  return out;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || k in out) continue;
    const v = part.slice(i + 1).trim();
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; } // keep raw value on broken %-encoding
  }
  return out;
}
