// deno-lint-ignore-file no-explicit-any -- optional, so loaded untyped: its types would pull in Node's
import { errMsg, NotFoundError } from "@qino/qino";

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
    await context.newPage();
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
  #tab: any; // where it acts

  constructor(context: any) {
    super();
    this.#context = context;
    context.on("page", (tab: any) => this.#open(tab));
    const request = (req: any) => ({ method: req.method(), url: req.url(), type: req.resourceType() });
    context.on("requestfinished", async (req: any) =>
      this.requested({ ...request(req), status: (await req.response().catch(() => null))?.status() }));
    context.on("requestfailed", (req: any) => this.requested({ ...request(req), error: req.failure()?.errorText }));
  }

  #open(tab: any) {
    this.#tab = tab;
    tab.on("console", (msg: any) => this.logged(msg.type(), msg.text()));
    tab.on("pageerror", (e: Error) => this.logged("error", errMsg(e)));
    tab.on("dialog", (d: any) => this.dialog(d.message(), (accept, text) => accept ? d.accept(text) : d.dismiss()));
    tab.on("close", () => {
      const left = this.#context.pages();
      if (this.#tab === tab) this.#tab = left.at(-1);
      if (!left.length) this.close();
    });
  }
  #at = (ref: string) => this.#tab.locator(`aria-ref=${ref}`);

  url(): string {
    return this.#tab.url();
  }
  title(): Promise<string> {
    return this.#tab.title();
  }
  goto(url: string): Promise<{ status(): number } | null> {
    return this.#tab.goto(url);
  }
  goBack(): Promise<unknown> {
    return this.#tab.goBack();
  }
  setContent(html: string): Promise<void> {
    return this.#tab.setContent(html);
  }
  evaluate<T>(fn: string | ((...args: any[]) => T), ...args: unknown[]): Promise<T> {
    return this.#tab.evaluate(fn, ...args);
  }
  setDefaultTimeout(ms: number): void {
    this.#context.setDefaultTimeout(ms);
  }
  async waitForLoadState(): Promise<void> {
    await this.#tab.waitForLoadState("load").catch(() => {});
    await this.#tab.waitForLoadState("networkidle", { timeout: 2_000 }).catch(() => {});
  }
  pdf(options?: object): Promise<Uint8Array<ArrayBuffer>> {
    return this.#tab.pdf(options);
  }
  snapshot(): Promise<string> {
    return this.#tab.ariaSnapshot({ mode: "ai" });
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
  tabs(): Promise<{ url: string; title: string }[]> {
    const tabs = this.#context.pages();
    return Promise.all(tabs.map(async (tab: any) => ({ url: tab.url(), title: await tab.title() })));
  }
  async tab(index: number): Promise<void> {
    const tab = this.#context.pages()[index];
    if (!tab) throw new NotFoundError(`No tab ${index}`);
    this.#tab = tab;
    await tab.bringToFront();
  }
  protected press(key: string): Promise<void> {
    return this.#tab.keyboard.press(key);
  }
  protected end(): Promise<void> {
    return this.#context.close();
  }
  protected box(ref: string): Promise<{ x: number; y: number; width: number; height: number }> {
    return this.#at(ref).evaluate((el: any) => {
      const r = el.getBoundingClientRect(), view = el.ownerDocument.defaultView;
      return { x: r.x + view.scrollX, y: r.y + view.scrollY, width: r.width, height: r.height };
    });
  }
  protected async cdp(method: string, params: object): Promise<any> {
    const session = await this.#context.newCDPSession(this.#tab);
    try {
      return await session.send(method, params);
    } finally {
      session.detach().catch(() => {});
    }
  }
}
