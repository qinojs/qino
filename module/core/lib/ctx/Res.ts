import { Csp } from "./Csp.ts";
import { HtmlBuilder } from "./HtmlBuilder.ts";

/**
 * Collects the outgoing response of rendered and thrown outputs — status,
 * headers, body, CSP and the lazy HTML document. The final native `Response`
 * is built by the app from this state; static/dbFile/streaming paths bypass it.
 */
export class ResponseBuilder {
  status = 200;
  headers: Headers = new Headers();
  body: BodyInit | undefined = "";
  csp: Csp = new Csp();

  #html: HtmlBuilder | null = null;
  get html(): HtmlBuilder { return this.#html ??= new HtmlBuilder(); }
  get hasHtml(): boolean { return this.#html !== null; }
}
