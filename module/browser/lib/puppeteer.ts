// deno-lint-ignore-file no-explicit-any -- puppeteer is optional and loaded untyped: its types would pull in Node's
import { errMsg, NotFoundError } from "@qino/qino";

import { Page } from "./Page.ts";

/** Optional, so not named where it would be resolved before use. */
const PACKAGE = "puppeteer-core";
/** States shown with an element when set: `[checked]`, `[level=2]`. */
const FLAGS = ["checked", "pressed", "selected", "expanded", "disabled", "required", "focused", "level"];

/** Chromium driven by Puppeteer: runs where Playwright does not, as in Deno without `--allow-all`. */
export class Puppeteer {
  #browser: any;

  constructor(browser: any) {
    this.#browser = browser;
  }

  /** Why it cannot run here, if it cannot: the package does not load. */
  static missing(): Promise<string | undefined> {
    return import(PACKAGE).then(() => undefined, (e) => `npm install ${PACKAGE} — ${errMsg(e)}`);
  }

  static async launch(cmd: string): Promise<Puppeteer> {
    const { default: puppeteer } = await import(PACKAGE);
    return new Puppeteer(await puppeteer.launch({
      executablePath: cmd,
      args: ["--force-webrtc-ip-handling-policy=disable_non_proxied_udp"], // WebRTC would talk UDP past the proxy
      defaultViewport: { width: 1280, height: 720 }, // as Playwright's
      pipe: true, // as Playwright: the browser ends with the process, however it ends
      // the app's signals stay the app's: puppeteer would exit the process
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    }));
  }

  /** A page in a context of its own (cookies, storage, cache), through `proxy` if given. */
  async page({ proxy }: { proxy?: string } = {}): Promise<Page> {
    // <-loopback>: Chromium would go to localhost directly
    const via = proxy ? { proxyServer: proxy, proxyBypassList: ["<-loopback>"] } : {};
    const context = await this.#browser.createBrowserContext({ downloadBehavior: { policy: "deny" }, ...via });
    const page = new PuppeteerPage(context);
    page.opened(await context.newPage());
    return page;
  }

  on(event: "disconnected", fn: () => void): void {
    this.#browser.on(event, fn);
  }
  close(): Promise<void> {
    return this.#browser.close();
  }
}

class PuppeteerPage extends Page {
  #context: any;
  #tab: any; // where it acts
  #known = new WeakSet();
  #refs = new Map<string, any>(); // the elements of the last snapshot
  #timeout?: number;

  constructor(context: any) {
    super();
    this.#context = context;
    context.on("targetcreated", async (target: any) => target.type() === "page" && this.opened(await target.page()));
  }

  /** A tab of the context: from now on it acts there. */
  opened(tab: any) {
    if (!tab || this.#known.has(tab)) return;
    this.#known.add(tab);
    this.#tab = tab;
    if (this.#timeout) tab.setDefaultTimeout(this.#timeout);
    const request = (req: any) => ({ method: req.method(), url: req.url(), type: req.resourceType().toLowerCase() });
    tab.on("console", (msg: any) => this.logged(msg.type(), msg.text()));
    tab.on("pageerror", (e: Error) => this.logged("error", errMsg(e)));
    tab.on("dialog", (d: any) => this.dialog(d.message(), (accept, text) => accept ? d.accept(text) : d.dismiss()));
    tab.on("requestfinished", (req: any) => this.requested({ ...request(req), status: req.response()?.status() }));
    tab.on("requestfailed", (req: any) => this.requested({ ...request(req), error: req.failure()?.errorText }));
    tab.on("close", async () => {
      const left = await this.#context.pages().catch(() => []);
      if (this.#tab === tab) this.#tab = left.at(-1);
      if (!left.length) this.close();
    });
  }

  async #element(ref: string) {
    const handle = await this.#refs.get(ref)?.elementHandle();
    if (!handle) throw new NotFoundError(`No element ${ref}: take a new snapshot`);
    return handle;
  }

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
    this.#timeout = ms;
    this.#tab.setDefaultTimeout(ms);
  }
  async waitForLoadState(): Promise<void> {
    await this.#tab.waitForNetworkIdle({ idleTime: 100, timeout: 5_000 }).catch(() => {});
  }
  pdf(options?: object): Promise<Uint8Array<ArrayBuffer>> {
    return this.#tab.pdf(options);
  }

  async snapshot(): Promise<string> {
    const refs = this.#refs = new Map(), lines: string[] = [];
    const walk = (node: any, depth: number) => {
      const ref = `e${refs.size + 1}`;
      refs.set(ref, node);
      const words = [
        node.role,
        node.name && JSON.stringify(node.name),
        node.value !== undefined && `value=${JSON.stringify(String(node.value))}`,
        node.url && `url=${node.url}`,
        ...FLAGS.map((flag) => node[flag] === true ? `[${flag}]` : node[flag] && `[${flag}=${node[flag]}]`),
        `[ref=${ref}]`,
      ];
      lines.push(`${"  ".repeat(depth)}- ${words.filter(Boolean).join(" ")}`);
      for (const child of node.children ?? []) walk(child, depth + 1);
    };
    const root = await this.#tab.accessibility.snapshot({ includeIframes: true });
    for (const child of root?.children ?? []) walk(child, 0);
    return lines.join("\n");
  }
  async click(ref: string): Promise<void> {
    await (await this.#element(ref)).asLocator().click();
  }
  async fill(ref: string, text: string): Promise<void> {
    await (await this.#element(ref)).asLocator().fill(text);
  }
  async selectOption(ref: string, values: string[]): Promise<void> {
    await (await this.#element(ref)).select(...values);
  }
  async hover(ref: string): Promise<void> {
    await (await this.#element(ref)).asLocator().hover();
  }
  async tabs(): Promise<{ url: string; title: string }[]> {
    const tabs = await this.#context.pages();
    return Promise.all(tabs.map(async (tab: any) => ({ url: tab.url(), title: await tab.title() })));
  }
  async tab(index: number): Promise<void> {
    const tab = (await this.#context.pages())[index];
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
  protected async box(ref: string): Promise<{ x: number; y: number; width: number; height: number }> {
    return (await this.#element(ref)).evaluate((el: any) => {
      const r = el.getBoundingClientRect(), view = el.ownerDocument.defaultView;
      return { x: r.x + view.scrollX, y: r.y + view.scrollY, width: r.width, height: r.height };
    });
  }
  protected async cdp(method: string, params: object): Promise<any> {
    const session = await this.#tab.createCDPSession();
    try {
      return await session.send(method, params);
    } finally {
      session.detach().catch(() => {});
    }
  }
}
