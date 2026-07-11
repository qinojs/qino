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

  toString(): string { return this.#url.href; }
  toJSON(): string { return this.#url.href; }
  [Symbol.toPrimitive](): string { return this.#url.href; }
}
