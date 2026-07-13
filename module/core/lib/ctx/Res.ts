import { ResCsp } from "./ResCsp.ts";
import { ResHtml } from "./ResHtml.ts";

/**
 * Collects the outgoing response of rendered and thrown outputs — status,
 * headers, body, CSP and the lazy HTML document. The final native `Response`
 * is built by the app from this state; static/dbFile/streaming paths bypass it.
 */
export class Res {
  status = 200;
  headers = new Headers();
  body: BodyInit | undefined = "";
  csp = new ResCsp();

  #html: ResHtml | null = null;
  get html(): ResHtml { return this.#html ??= new ResHtml(); }
  get hasHtml(): boolean { return this.#html !== null; }
}
