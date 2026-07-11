/**
 * Immutable facade over the request URL. Readers share one parsed instance;
 * mutation goes through `toURL()`, which returns an independent native `URL`.
 * Deliberately not a `URL` subclass and without `searchParams` — query access
 * lives on the request (`req.query`/`req.queryAll`).
 */
export class RequestUrl {
  #url: URL;

  constructor(input: string | URL) {
    this.#url = new URL(input);
    Object.freeze(this);
  }

  get href(): string { return this.#url.href; }
  get origin(): string { return this.#url.origin; }
  get protocol(): string { return this.#url.protocol; }
  get host(): string { return this.#url.host; }
  get hostname(): string { return this.#url.hostname; }
  get port(): string { return this.#url.port; }
  get pathname(): string { return this.#url.pathname; }
  get search(): string { return this.#url.search; }
  get hash(): string { return this.#url.hash; }

  /** Independent, mutable native `URL` copy. */
  toURL(): URL { return new URL(this.#url); }

  // Migration guard: `ctx.req.url` used to be a string; implicit stringification
  // would silently survive the migration. Throws until the old API is gone
  // (CONTEXT-REQUEST-PLAN.md Phase 7), then switches to `href`.
  toString(): never { throw new Error("RequestUrl: use .href or .toURL()"); }
  toJSON(): never { throw new Error("RequestUrl: use .href or .toURL()"); }
  [Symbol.toPrimitive](): never { throw new Error("RequestUrl: use .href or .toURL()"); }
}
