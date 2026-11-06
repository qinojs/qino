// deno-lint-ignore-file no-explicit-any -- puppeteer is optional and loaded untyped: its types would pull in Node's
import { errMsg, NotFoundError } from "@qino/qino";

/** Optional, so not named where it would be resolved before use. */
const PACKAGE = "puppeteer-core";
/** States shown with an element when set: `[checked]`, `[level=2]`. */
const FLAGS = ["checked", "pressed", "selected", "expanded", "disabled", "required", "focused", "level"];

/** A running Chromium, driven by Puppeteer. */
export class Chrome {
  #browser: any;

  constructor(browser: any) {
    this.#browser = browser;
  }

  /** Why it cannot run here, if it cannot: the package does not load. */
  static missing(): Promise<string | undefined> {
    return import(PACKAGE).then(() => undefined, (e) => `npm install ${PACKAGE} — ${errMsg(e)}`);
  }

  static async launch(cmd: string): Promise<Chrome> {
    const { default: puppeteer } = await import(PACKAGE).catch((e) => {
      throw new Error(`browser: ${PACKAGE} does not load (npm install ${PACKAGE}) — ${errMsg(e)}`);
    });
    return new Chrome(await puppeteer.launch({
      executablePath: cmd,
      args: ["--force-webrtc-ip-handling-policy=disable_non_proxied_udp"], // WebRTC would talk UDP past the proxy
      // the app's signals stay the app's: puppeteer would exit the process
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    }));
  }

  /** A page in a context of its own (cookies, storage, cache), through `proxy` if given; gone with the page. */
  async page({ proxy }: { proxy?: string } = {}): Promise<Page> {
    // <-loopback>: Chromium would go to localhost directly
    const via = proxy ? { proxyServer: proxy, proxyBypassList: ["<-loopback>"] } : {};
    const context = await this.#browser.createBrowserContext({ downloadBehavior: { policy: "deny" }, ...via });
    const page = await context.newPage();
    page.once("close", () => context.close().catch(() => {}));
    return new Page(page);
  }

  on(event: "disconnected", fn: () => void): void {
    this.#browser.on(event, fn);
  }

  close(): Promise<void> {
    return this.#browser.close();
  }
}

/**
 * A page, as Playwright and Puppeteer have it (the same names, a part of them), and for agents its
 * `snapshot()` with refs to `click` and `fill` by.
 */
export class Page {
  #page: any;
  #refs = new Map<string, any>(); // the elements of the last snapshot
  keyboard: { press(key: string): Promise<void> };

  constructor(page: any) {
    this.#page = page;
    this.keyboard = { press: (key) => page.keyboard.press(key) };
  }

  url(): string {
    return this.#page.url();
  }
  title(): Promise<string> {
    return this.#page.title();
  }
  goto(url: string): Promise<{ status(): number; ok(): boolean; url(): string } | null> {
    return this.#page.goto(url);
  }
  setContent(html: string): Promise<void> {
    return this.#page.setContent(html);
  }
  evaluate<T>(fn: string | ((...args: any[]) => T), ...args: unknown[]): Promise<T> {
    return this.#page.evaluate(fn, ...args);
  }
  setDefaultTimeout(ms: number): void {
    this.#page.setDefaultTimeout(ms);
  }
  pdf(options?: {
    format?: string;
    landscape?: boolean;
    margin?: { top?: string; right?: string; bottom?: string; left?: string };
    printBackground?: boolean;
    preferCSSPageSize?: boolean;
    scale?: number;
    pageRanges?: string;
  }): Promise<Uint8Array<ArrayBuffer>> {
    return this.#page.pdf(options);
  }
  screenshot(
    options?: { fullPage?: boolean; type?: "png" | "jpeg"; quality?: number },
  ): Promise<Uint8Array<ArrayBuffer>> {
    return this.#page.screenshot(options);
  }
  on(event: "close", fn: () => void): void {
    this.#page.on(event, fn);
  }
  close(): Promise<void> {
    return this.#page.close();
  }

  /** The accessibility tree as text, an element a line with a ref: `- button "Go" [ref=e3]`; once what
   *  an action started (a navigation, a request) is done, or after a while. */
  async snapshot(): Promise<string> {
    await this.#page.waitForNetworkIdle({ idleTime: 100, timeout: 5_000 }).catch(() => {});
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
    const root = await this.#page.accessibility.snapshot({ includeIframes: true });
    for (const child of root?.children ?? []) walk(child, 0);
    return lines.join("\n");
  }

  /** Click the element of a ref from the last snapshot. */
  async click(ref: string): Promise<void> {
    await (await this.#element(ref)).click();
  }
  /** Fill the text field of a ref from the last snapshot, replacing what it holds. */
  async fill(ref: string, text: string): Promise<void> {
    await (await this.#element(ref)).asLocator().fill(text);
  }

  async #element(ref: string) {
    const handle = await this.#refs.get(ref)?.elementHandle();
    if (!handle) throw new NotFoundError(`No element ${ref}: take a new snapshot`);
    return handle;
  }
}
