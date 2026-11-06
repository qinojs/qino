// deno-lint-ignore-file no-explicit-any -- a driver's tabs are untyped: its types would pull in Node's
import { errMsg, NotFoundError } from "@qino/qino";

/** How many console messages and requests a page keeps, the latest. */
const KEEP = 500;

/** What the page shows, in CSS pixels of the document; with `full` all of it. */
const AREA = (full: boolean) => full
  ? "({ x: 0, y: 0, width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })"
  : "({ x: scrollX, y: scrollY, width: innerWidth, height: innerHeight })";

type Message = { type: string; text: string };
type Request = { method: string; url: string; type: string; status?: number; error?: string };
type Area = { x: number; y: number; width: number; height: number };

/**
 * A page as Playwright has it — the same names, a part of them — the same with every driver. For agents
 * also its `snapshot()` with refs to act by, and what it told meanwhile (`news()`): console, dialogs, tabs.
 * Playwright and Puppeteer name their tabs' methods and events alike: what they share is here.
 */
export abstract class Page {
  keyboard: { press(key: string): Promise<void> } = { press: (key) => this.current.keyboard.press(key) };
  /** The tab it acts in: the last one opened, or the one chosen with `tab()`. */
  protected current: any;
  #console: Message[] = [];
  #told = 0; // console messages already in news
  #requests: Request[] = [];
  #dialog?: { message: string; answer: (accept: boolean, text?: string) => Promise<void> };
  #opened = Promise.withResolvers<void>();
  #closed: (() => void)[] = [];
  #done = false;

  abstract setDefaultTimeout(ms: number): void;
  /** Until what an action started (a navigation, requests) is done, or a while has passed. */
  abstract waitForLoadState(): Promise<void>;
  /** The accessibility tree as text, an element a line with a ref to act by: `- button "Go" [ref=e3]`. */
  abstract snapshot(): Promise<string>;
  /** By a ref of the last snapshot, waiting until the element can take it. */
  abstract click(ref: string): Promise<void>;
  abstract fill(ref: string, text: string): Promise<void>;
  abstract selectOption(ref: string, values: string[]): Promise<void>;
  abstract hover(ref: string): Promise<void>;
  /** The context's tabs, as the driver has them. */
  protected abstract pages(): Promise<any[]>;
  /** The element of a ref, as the driver has it: one to `evaluate` in. */
  protected abstract element(ref: string): Promise<any>;
  /** A DevTools protocol session with the tab it acts in. */
  protected abstract session(): Promise<any>;
  protected abstract end(): Promise<void>;

  url(): string {
    return this.current.url();
  }
  title(): Promise<string> {
    return this.current.title();
  }
  goto(url: string): Promise<{ status(): number } | null> {
    return this.current.goto(url);
  }
  goBack(): Promise<unknown> {
    return this.current.goBack();
  }
  setContent(html: string): Promise<void> {
    return this.current.setContent(html);
  }
  evaluate<T>(fn: string | ((...args: any[]) => T), ...args: unknown[]): Promise<T> {
    return this.current.evaluate(fn, ...args);
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
    return this.current.pdf(options);
  }

  /**
   * What the page shows, all of it (`fullPage`), an area (`clip`, CSS pixels of the page) or an element
   * (`ref`). With `maxSize` at most so many pixels on its longer side: rendered smaller, not scaled after.
   */
  async screenshot({ fullPage = false, clip, ref, type = "png", quality, maxSize }: {
    fullPage?: boolean;
    clip?: Area;
    ref?: string;
    type?: "png" | "jpeg";
    quality?: number;
    maxSize?: number;
  } = {}): Promise<Uint8Array<ArrayBuffer>> {
    const area: Area = ref
      ? await (await this.element(ref)).evaluate((el: any) => {
        const r = el.getBoundingClientRect(), view = el.ownerDocument.defaultView;
        return { x: r.x + view.scrollX, y: r.y + view.scrollY, width: r.width, height: r.height };
      })
      : clip ?? await this.evaluate<Area>(AREA(fullPage));
    const scale = maxSize ? Math.min(1, maxSize / Math.max(area.width, area.height)) : 1;
    const session = await this.session();
    try {
      const { data } = await session.send("Page.captureScreenshot", {
        format: type,
        ...type === "jpeg" && { quality },
        clip: { ...area, scale },
        captureBeyondViewport: true,
      });
      return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    } finally {
      session.detach().catch(() => {});
    }
  }

  async tabs(): Promise<{ url: string; title: string }[]> {
    return Promise.all((await this.pages()).map(async (tab) => ({ url: tab.url(), title: await tab.title() })));
  }
  async tab(index: number): Promise<void> {
    const tab = (await this.pages())[index];
    if (!tab) throw new NotFoundError(`No tab ${index}`);
    this.current = tab;
    await tab.bringToFront();
  }

  /** Console messages and errors, the latest `KEEP`. */
  consoleMessages(): Message[] {
    return [...this.#console];
  }
  /** The requests done, the latest `KEEP`. */
  requests(): Request[] {
    return [...this.#requests];
  }

  /** What an agent should know after an action: new warnings and errors, a waiting dialog, the tabs if more
   *  than one — not while a dialog holds the page, reading them would wait for it. */
  async news(): Promise<{ console?: Message[]; dialog?: string; tabs?: { url: string; title: string }[] }> {
    const console = this.#console.slice(this.#told).filter((m) => m.type === "error" || m.type === "warning");
    this.#told = this.#console.length;
    const dialog = this.#dialog?.message;
    const tabs = dialog ? [] : await this.tabs();
    return { ...console.length && { console }, ...dialog && { dialog }, ...tabs.length > 1 && { tabs } };
  }

  /** Settles when a dialog opens: an action waiting for the page would wait for good. */
  dialogOpened(): Promise<void> {
    return this.#opened.promise;
  }
  /** Accept (with `text` for a prompt) or dismiss the waiting dialog. */
  async handleDialog(accept: boolean, text?: string): Promise<void> {
    const dialog = this.#dialog;
    if (!dialog) throw new NotFoundError("No dialog is waiting");
    this.#dialog = undefined;
    await dialog.answer(accept, text);
  }

  on(_event: "close", fn: () => void): void {
    this.#closed.push(fn);
  }
  async close(): Promise<void> {
    if (this.#done) return;
    this.#done = true;
    await this.end().catch(() => {});
    for (const fn of this.#closed) fn();
  }

  /** A tab of its context opened: from now on it acts there, and hears what it tells. */
  protected opened(tab: any) {
    this.current = tab;
    tab.on("console", (msg: any) => this.#log(msg.type(), msg.text()));
    tab.on("pageerror", (e: Error) => this.#log("error", errMsg(e)));
    tab.on("dialog", (d: any) => {
      this.#dialog = { message: d.message(), answer: (accept, text) => accept ? d.accept(text) : d.dismiss() };
      this.#opened.resolve();
      this.#opened = Promise.withResolvers();
    });
    tab.on("close", async () => {
      const left = await this.pages().catch(() => []);
      if (this.current === tab) this.current = left.at(-1);
      if (!left.length) this.close();
    });
  }
  /** A request done, for the drivers: each hears them its own way. */
  protected requested(request: Request) {
    this.#requests.push(request);
    if (this.#requests.length > KEEP) this.#requests.shift();
  }

  #log(type: string, text: string) {
    this.#console.push({ type: type === "warn" ? "warning" : type, text }); // "warn": Puppeteer's name
    if (this.#console.length > KEEP) this.#console.shift(), this.#told = Math.max(0, this.#told - 1);
  }
}
