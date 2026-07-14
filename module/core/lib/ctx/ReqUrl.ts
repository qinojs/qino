/**
 * Immutable facade over the request URL. Readers share one parsed instance;
 * mutation goes through `toURL()`, which returns an independent native `URL`.
 * Deliberately not a `URL` subclass and without `searchParams` — query access
 * lives on the request (`req.query`/`req.queryAll`).
 */
export class ReqUrl {
  #url: URL;

  constructor(input: string | URL) {
    this.#url = new URL(input);
    Object.freeze(this);
  }

  get href() { return this.#url.href; }
  get origin() { return this.#url.origin; }
  get protocol() { return this.#url.protocol; }
  get host() { return this.#url.host; }
  get hostname() { return this.#url.hostname; }
  get port() { return this.#url.port; }
  get pathname() { return this.#url.pathname; }
  get search() { return this.#url.search; }
  get hash() { return this.#url.hash; }

  /** Independent, mutable native `URL` copy. */
  toURL() { return new URL(this.#url); }

  toString() { return this.#url.href; }
  toJSON() { return this.#url.href; }
  [Symbol.toPrimitive]() { return this.#url.href; }
}
