import { ResCsp } from "./ResCsp.ts";
import { ResHtml } from "./ResHtml.ts";

/**
 * Collects the response: status, headers, body, CSP and the lazy HTML document. The app builds the
 * native `Response` from it; static files, dbFiles and streams bypass it.
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

  /** Whether anything was answered. Untouched means 404, not an empty 200 — for an empty body, set
   *  a status. */
  get answered(): boolean {
    return this.hasHtml || !!this.body || this.#statusSet || this.headers.has("Location");
  }
}
