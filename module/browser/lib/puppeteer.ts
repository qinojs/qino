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
    return PuppeteerPage.of(context);
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
  #known = new WeakSet(); // tabs heard: the first one comes as a target too
  #refs = new Map<string, any>(); // the elements of the last snapshot
  #timeout?: number;

  constructor(context: any) {
    super();
    this.#context = context;
    context.on("targetcreated", async (target: any) => target.type() === "page" && this.opened(await target.page()));
  }

  /** The page of `context`, with its first tab. */
  static async of(context: any): Promise<PuppeteerPage> {
    const page = new PuppeteerPage(context);
    page.opened(await context.newPage());
    return page;
  }

  /** Puppeteer has the timeout and the requests per tab. */
  protected override opened(tab: any) {
    if (!tab || this.#known.has(tab)) return;
    this.#known.add(tab);
    super.opened(tab);
    if (this.#timeout) tab.setDefaultTimeout(this.#timeout);
    const request = (req: any) => ({ method: req.method(), url: req.url(), type: req.resourceType().toLowerCase() });
    tab.on("requestfinished", (req: any) => this.requested({ ...request(req), status: req.response()?.status() }));
    tab.on("requestfailed", (req: any) => this.requested({ ...request(req), error: req.failure()?.errorText }));
  }

  setDefaultTimeout(ms: number): void {
    this.#timeout = ms;
    this.current.setDefaultTimeout(ms);
  }
  async waitForLoadState(): Promise<void> {
    await this.current.waitForNetworkIdle({ idleTime: 100, timeout: 5_000 }).catch(() => {});
  }
  /** Built from Puppeteer's accessibility tree, as Playwright's looks. */
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
    const root = await this.current.accessibility.snapshot({ includeIframes: true });
    for (const child of root?.children ?? []) walk(child, 0);
    return lines.join("\n");
  }
  async click(ref: string): Promise<void> {
    await (await this.element(ref)).asLocator().click();
  }
  async fill(ref: string, text: string): Promise<void> {
    await (await this.element(ref)).asLocator().fill(text);
  }
  async selectOption(ref: string, values: string[]): Promise<void> {
    await (await this.element(ref)).select(...values);
  }
  async hover(ref: string): Promise<void> {
    await (await this.element(ref)).asLocator().hover();
  }

  protected pages(): Promise<any[]> {
    return this.#context.pages();
  }
  protected async element(ref: string): Promise<any> {
    const handle = await this.#refs.get(ref)?.elementHandle();
    if (!handle) throw new NotFoundError(`No element ${ref}: take a new snapshot`);
    return handle;
  }
  protected session(): Promise<any> {
    return this.current.createCDPSession();
  }
  protected end(): Promise<void> {
    return this.#context.close();
  }
}
