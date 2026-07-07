import type { Req } from "./Req.ts";
import { readUploadFile, type UploadedFile } from "./fileStream.ts";
import { Output } from "./util.ts";

/**
 * Parsed request body: fields eager, per-file disk spooling lazy.
 * `body.post` is the parsed body itself: null (no/unknown body),
 * flat frozen record (form) or deep-frozen JSON value (object/array/string/...).
 * `await body.files.name` spools exactly that file to a tmp path.
 */
export class Body {
  // deno-lint-ignore no-explicit-any
  #post: any = null;
  // deno-lint-ignore no-explicit-any
  get post(): any { return this.#post; }

  readonly files: Record<string, Promise<UploadedFile> | undefined>;
  /** tmp file paths spooled so far — removed in RequestContext.cleanup() */
  tmpPaths: string[] = [];
  #rawFiles: Record<string, File> = Object.create(null);
  #spooled: Record<string, Promise<UploadedFile>> = Object.create(null);
  #maxSize = 0; // set by parse(); only parse() can add files

  constructor() {
    this.files = new Proxy(Object.create(null), {
      get: (_, key) => typeof key === "string" && this.#rawFiles[key] ? this.#spool(key) : undefined,
      has: (_, key) => typeof key === "string" && key in this.#rawFiles,
      ownKeys: () => Object.keys(this.#rawFiles),
      getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
      set: () => false,
    });
  }

  #spool(key: string): Promise<UploadedFile> {
    let p = this.#spooled[key];
    if (!p) {
      p = this.#spooled[key] = readUploadFile(this.#rawFiles[key], { maxSize: this.#maxSize })
        .then((f) => (this.tmpPaths.push(f.tmpPath), f));
      p.catch(() => {}); // property access without await must not become an unhandled rejection
    }
    return p;
  }

  /** Wait for running spools, then return the tmp paths (for cleanup). */
  async settle(): Promise<string[]> {
    await Promise.allSettled(Object.values(this.#spooled));
    return this.tmpPaths;
  }

  static async parse(req: Req, opt: { maxSize: number }): Promise<Body> {
    const body = new Body();
    body.#maxSize = opt.maxSize;
    if (!req.raw.body) return body;
    if (Number(req.header("content-length") ?? "0") > opt.maxSize) throw new Output("Payload Too Large", { status: 413 });

    const bad = () => { throw new Output("Bad Request", { status: 400 }); };
    const ct = req.header("content-type") ?? "";
    if (ct.includes("application/json") || ct.includes("application/csp-report")) {
      body.#post = deepFreeze(await req.json().catch(bad));
    } else if (ct.includes("multipart/form-data") || ct.includes("application/x-www-form-urlencoded")) {
      const post: Record<string, unknown> = Object.create(null);
      for (const [key, val] of Object.entries(await req.parseBody().catch(bad))) {
        if (val instanceof File) body.#rawFiles[key] = val;
        else post[key] = val;
      }
      body.#post = Object.freeze(post);
    }
    return body;
  }
}

// deno-lint-ignore no-explicit-any
function deepFreeze(v: any): any {
  if (v && typeof v === "object") {
    for (const child of Object.values(v)) deepFreeze(child);
    Object.freeze(v);
  }
  return v;
}
