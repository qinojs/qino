import { ResCsp } from "./ResCsp.ts";
import { ResHtml } from "./ResHtml.ts";

/**
 * Collects the outgoing response of rendered and thrown outputs — status,
 * headers, body, CSP and the lazy HTML document. The final native `Response`
 * is built by the app from this state; static/dbFile/streaming paths bypass it.
 */
export class Res {
  headers: Headers = new Headers();
  body: BodyInit | undefined = "";
  csp: ResCsp = new ResCsp();

  #status = 200;
  get status(): number { return this.#status; }
  set status(v: number) { this.#status = v; this.#statusSet = true; }
  #statusSet = false;

  #html: ResHtml | null = null;
  get html(): ResHtml { return this.#html ??= new ResHtml(); }
  get hasHtml(): boolean { return this.#html !== null; }

  /** Whether anyone answered at all. An untouched Res is nobody's answer, not an empty 200 —
   *  a module that means an empty body says so by setting a status. */
  get answered(): boolean {
    return this.hasHtml || !!this.body || this.#statusSet || this.headers.has("Location");
  }
}
