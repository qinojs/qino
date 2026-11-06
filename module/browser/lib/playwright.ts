// deno-lint-ignore-file no-explicit-any -- optional, so loaded untyped: its types would pull in Node's
import { errMsg } from "@qino/qino";

import { Page } from "./Page.ts";

/** Optional, so not named where it would be resolved before use. */
const PACKAGE = "playwright-core";

/** Chromium driven by Playwright: what agents know best. In Deno it needs `--allow-all`. */
export class Playwright {
  #browser: any;

  constructor(browser: any) {
    this.#browser = browser;
  }

  /** Why it cannot run here, if it cannot. */
  static missing(): Promise<string | undefined> {
    return import(PACKAGE).then(() => undefined, (e) => `npm install ${PACKAGE} — ${errMsg(e)}`);
  }

  static async launch(cmd: string): Promise<Playwright> {
    const { chromium } = await import(PACKAGE);
    // WebRTC would talk UDP past the proxy
    const args = ["--force-webrtc-ip-handling-policy=disable_non_proxied_udp"];
    return new Playwright(await chromium.launch({ executablePath: cmd, args }));
  }

  /** A page in a context of its own (cookies, storage, cache), through `proxy` if given. */
  async page({ proxy }: { proxy?: string } = {}): Promise<Page> {
    // <-loopback>: Chromium would go to localhost directly
    const via = proxy ? { proxy: { server: proxy, bypass: "<-loopback>" } } : {};
    const context = await this.#browser.newContext({ acceptDownloads: false, ...via });
    const page = new PlaywrightPage(context);
    await context.newPage(); // heard as the context's "page"
    return page;
  }

  on(event: "disconnected", fn: () => void): void {
    this.#browser.on(event, fn);
  }
  close(): Promise<void> {
    return this.#browser.close();
  }
}

class PlaywrightPage extends Page {
  #context: any;

  constructor(context: any) {
    super();
    this.#context = context;
    context.on("page", (tab: any) => this.opened(tab));
    const request = (req: any) => ({ method: req.method(), url: req.url(), type: req.resourceType() });
    context.on("requestfinished", async (req: any) =>
      this.requested({ ...request(req), status: (await req.response().catch(() => null))?.status() }));
    context.on("requestfailed", (req: any) => this.requested({ ...request(req), error: req.failure()?.errorText }));
  }

  setDefaultTimeout(ms: number): void {
    this.#context.setDefaultTimeout(ms);
  }
  async waitForLoadState(): Promise<void> {
    await this.current.waitForLoadState("load").catch(() => {});
    await this.current.waitForLoadState("networkidle", { timeout: 2_000 }).catch(() => {});
  }
  snapshot(): Promise<string> {
    return this.current.ariaSnapshot({ mode: "ai" });
  }
  click(ref: string): Promise<void> {
    return this.#at(ref).click();
  }
  fill(ref: string, text: string): Promise<void> {
    return this.#at(ref).fill(text);
  }
  async selectOption(ref: string, values: string[]): Promise<void> {
    await this.#at(ref).selectOption(values);
  }
  hover(ref: string): Promise<void> {
    return this.#at(ref).hover();
  }

  protected async pages(): Promise<any[]> {
    return this.#context.pages();
  }
  protected async element(ref: string): Promise<any> {
    return this.#at(ref);
  }
  protected session(): Promise<any> {
    return this.#context.newCDPSession(this.current);
  }
  protected end(): Promise<void> {
    return this.#context.close();
  }

  #at = (ref: string) => this.current.locator(`aria-ref=${ref}`);
}
