import { ReqBody } from "./ReqBody.ts";
import { ReqDeadline } from "./ReqDeadline.ts";
import { ReqUrl } from "./ReqUrl.ts";
import { clientIp, ensureSlash, Output } from "../util.ts";
import type { UploadedFile } from "../fileStream.ts";

/**
 * The fully initialized request of the dynamic phase — created once per request,
 * after prefilter and static check. Request data is read-only; a mutable URL
 * copy comes from `req.url.toURL()`.
 */
export class Req {
  #raw: Request;
  #nativeUrl: URL;
  #url: ReqUrl;
  #peerAddr: string;
  #time: number;
  #body: ReqBody;
  #clientIp: string;
  #appUrl: string;
  #appPath: string;
  #query: Readonly<Record<string, string>> | undefined;
  #queryAll: Readonly<Record<string, readonly string[]>> | undefined;
  #cookies: Readonly<Record<string, string>> | undefined;
  #deadline: ReqDeadline | null = null;

  constructor(raw: Request, url: URL, body: ReqBody, opt: { peerAddr: string; time: number; appUrl: string; appPath: string; clientIp: string }) {
    this.#raw = raw;
    this.#nativeUrl = url;
    this.#url = new ReqUrl(url);
    this.#body = body;
    this.#peerAddr = opt.peerAddr;
    this.#time = opt.time;
    this.#appUrl = opt.appUrl;
    this.#appPath = opt.appPath;
    this.#clientIp = opt.clientIp;
  }

  get raw(): Request { return this.#raw; }
  /** Immutable request URL; `url.toURL()` yields an independent mutable native `URL`. */
  get url(): ReqUrl { return this.#url; }
  get method(): string { return this.#raw.method; }
  get headers(): Headers { return this.#raw.headers; }
  /** Direct TCP peer address (from the runtime), the only unspoofable IP source. */
  get peerAddr(): string { return this.#peerAddr; }
  /** performance.now() when the request entered the pipeline. */
  get time(): number { return this.#time; }
  /** Parsed method-independent body: null (no/unknown body), flat frozen record (form) or deep-frozen JSON value. */
  // deno-lint-ignore no-explicit-any
  get body(): any { return this.#body.value; }
  /** Lazy per-file upload access: `await req.files.name` spools that file to tmp. */
  get files(): Record<string, Promise<UploadedFile> | undefined> { return this.#body.files; }
  /** Client IP after `trustedProxyHops`. */
  get clientIp(): string { return this.#clientIp; }
  /** Mount prefix of this request, always with trailing slash (e.g. `/cms1/`). */
  get appUrl(): string { return this.#appUrl; }
  /** Where module files are served from: `appUrl` + `m/`. Data files are below `Module.dataUrl`. */
  get moduleUrl(): string { return this.#appUrl + "m/"; }
  /** Decoded app-relative routing path, without base prefix and query.
   *  A URL path — not to be confused with `app.appPATH` (filesystem path). */
  get appPath(): string { return this.#appPath; }
  /** Time limit + abort signal of this request: `req.deadline.left += 60`, `req.deadline.signal`. */
  get deadline(): ReqDeadline { return this.#deadline ??= new ReqDeadline(this.#raw.signal); }

  /** Query params, first value per key. */
  get query(): Readonly<Record<string, string>> {
    if (!this.#query) {
      const out: Record<string, string> = Object.create(null);
      for (const [k, v] of this.#nativeUrl.searchParams) if (!(k in out)) out[k] = v;
      this.#query = Object.freeze(out);
    }
    return this.#query;
  }

  /** Query params, every value per key. */
  get queryAll(): Readonly<Record<string, readonly string[]>> {
    if (!this.#queryAll) {
      const sp = this.#nativeUrl.searchParams;
      const out: Record<string, readonly string[]> = Object.create(null);
      for (const k of sp.keys()) out[k] ??= Object.freeze(sp.getAll(k));
      this.#queryAll = Object.freeze(out);
    }
    return this.#queryAll;
  }

  /** Incoming request cookies only — response cookies never show up here. */
  get cookies(): Readonly<Record<string, string>> {
    return this.#cookies ??= Object.freeze(parseCookies(this.header("cookie")));
  }

  /** Like `headers.get()`, but `undefined` instead of `null` on a miss. */
  header(name: string): string | undefined {
    return this.#raw.headers.get(name) ?? undefined;
  }

  /** Clear the deadline, wait for running upload spools and remove their tmp files. */
  async cleanup(): Promise<void> {
    this.#deadline?.clear();
    for (const p of await this.#body.settle()) await Deno.remove(p).catch(() => {});
  }

  static async create(request: Request, opt: {
    url?: URL; appUrl?: string; peerAddr?: string; time?: number;
    maxSize?: number; trustedProxyHops?: number;
  } = {}): Promise<Req> {
    const url = publicScheme(request, opt.url ?? new URL(request.url), opt.trustedProxyHops ?? 0);
    const appUrl = ensureSlash(opt.appUrl || "/");
    if (!url.pathname.startsWith(appUrl)) throw new Output("Not Found", { status: 404 });
    const peerAddr = opt.peerAddr ?? "";
    const body = await ReqBody.parse(request, { maxSize: opt.maxSize || 100 * 1024 * 1024 });

    let appPath: string;
    try { appPath = decodeURIComponent(url.pathname.slice(appUrl.length)); }
    catch { throw new Output("Bad Request", { status: 400 }); }

    return new Req(request, url, body, {
      peerAddr,
      time: opt.time ?? performance.now(),
      appUrl,
      appPath,
      clientIp: clientIp(request, peerAddr, opt.trustedProxyHops ?? 0),
    });
  }
}

/** A TLS-terminating proxy forwards plain http to the local port, so `request.url` would make every
 *  absolute self-link `http://`. Same trust model as `clientIp`: only honoured when hops > 0. */
function publicScheme(request: Request, url: URL, hops: number): URL {
  if (hops <= 0) return url;
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  if ((proto !== "http" && proto !== "https") || url.protocol === proto + ":") return url;
  const out = new URL(url);
  out.protocol = proto + ":";
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
