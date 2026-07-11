import type { Req } from "./Req.ts";
import { readUploadFile, type UploadedFile } from "../fileStream.ts";
import { Output } from "../util.ts";

/**
 * Parsed request body: fields eager, per-file disk spooling lazy.
 * `body.value` is the parsed body itself: null (no/unknown body),
 * flat frozen record (form) or deep-frozen JSON value (object/array/string/...).
 * `await body.files.name` spools exactly that file to a tmp path.
 */
export class Body {
  // deno-lint-ignore no-explicit-any
  #value: any = null;
  // deno-lint-ignore no-explicit-any
  get value(): any { return this.#value; }

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

    const ct = req.header("content-type") ?? "";
    const isJson = ct.includes("application/json") || ct.includes("application/csp-report");
    const isForm = ct.includes("multipart/form-data") || ct.includes("application/x-www-form-urlencoded");
    if (!isJson && !isForm) return body; // raw/streaming bodies stay untouched, readable via req

    const lenHeader = req.header("content-length");
    const len = lenHeader != null && /^\d+$/.test(lenHeader) ? Number(lenHeader) : null;
    if (len != null && len > opt.maxSize) throw new Output("Payload Too Large", { status: 413 });
    // without a valid declared length (chunked/bogus) the body is read through a capped reader instead
    const src = len == null ? await cappedResponse(req, opt.maxSize) : null;

    const bad = () => { throw new Output("Bad Request", { status: 400 }); };
    if (isJson) {
      body.#value = deepFreeze(await (src ? src.json() : req.json()).catch(bad));
    } else {
      const entries = groupFormData(await (src ?? req.raw.clone()).formData().catch(bad));
      const post: Record<string, unknown> = Object.create(null);
      for (const [key, val] of Object.entries(entries)) {
        const vals = Array.isArray(val) ? val : [val];
        const files = vals.filter((v) => v instanceof File) as File[];
        const fields = vals.filter((v) => !(v instanceof File));
        if (files.length) body.#rawFiles[key] = files[files.length - 1]; // several files per name: last wins
        if (fields.length) post[key] = fields.length > 1 ? Object.freeze(fields) : fields[0];
      }
      body.#value = Object.freeze(post);
    }
    return body;
  }
}

/** Buffer a cloned body with a hard size cap — for chunked bodies that declare no content-length. */
async function cappedResponse(req: Req, maxSize: number): Promise<Response> {
  const chunks: BlobPart[] = [];
  let size = 0;
  const reader = req.raw.clone().body!.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if ((size += value.length) > maxSize) {
      reader.cancel().catch(() => {}); // tee-branch cancel resolves only after the raw branch ends — never await it
      throw new Output("Payload Too Large", { status: 413 });
    }
    chunks.push(value);
  }
  return new Response(new Blob(chunks), { headers: { "content-type": req.header("content-type") ?? "" } });
}

// deno-lint-ignore no-explicit-any
function deepFreeze(v: any): any {
  if (v && typeof v === "object") {
    for (const child of Object.values(v)) deepFreeze(child);
    Object.freeze(v);
  }
  return v;
}

/** FormData as a flat record; repeated keys become arrays. */
function groupFormData(form: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = Object.create(null);
  for (const [k, v] of form) {
    const cur = out[k];
    if (cur === undefined) out[k] = v;
    else if (Array.isArray(cur)) cur.push(v);
    else out[k] = [cur, v];
  }
  return out;
}
