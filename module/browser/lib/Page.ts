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
 */
export abstract class Page {
  keyboard: { press(key: string): Promise<void> } = { press: (key) => this.press(key) };
  #console: Message[] = [];
  #told = 0; // console messages already in news
  #requests: Request[] = [];
  #dialog?: { message: string; answer: (accept: boolean, text?: string) => Promise<void> };
  #opened = Promise.withResolvers<void>();
  #closed: (() => void)[] = [];
  #done = false;

  abstract url(): string;
  abstract title(): Promise<string>;
  abstract goto(url: string): Promise<{ status(): number } | null>;
  abstract goBack(): Promise<unknown>;
  abstract setContent(html: string): Promise<void>;
  // deno-lint-ignore no-explicit-any
  abstract evaluate<T>(fn: string | ((...args: any[]) => T), ...args: unknown[]): Promise<T>;
  abstract setDefaultTimeout(ms: number): void;
  /** Until what an action started (a navigation, requests) is done, or a while has passed. */
  abstract waitForLoadState(): Promise<void>;
  abstract pdf(options?: {
    format?: string;
    landscape?: boolean;
    margin?: { top?: string; right?: string; bottom?: string; left?: string };
    printBackground?: boolean;
    preferCSSPageSize?: boolean;
    scale?: number;
    pageRanges?: string;
  }): Promise<Uint8Array<ArrayBuffer>>;

  /** The accessibility tree as text, an element a line with a ref to act by: `- button "Go" [ref=e3]`. */
  abstract snapshot(): Promise<string>;
  /** By a ref of the last snapshot, waiting until the element can take it. */
  abstract click(ref: string): Promise<void>;
  abstract fill(ref: string, text: string): Promise<void>;
  abstract selectOption(ref: string, values: string[]): Promise<void>;
  abstract hover(ref: string): Promise<void>;
  /** The open tabs; the page acts in the last one opened, or the one chosen with `tab()`. */
  abstract tabs(): Promise<{ url: string; title: string }[]>;
  abstract tab(index: number): Promise<void>;
  protected abstract press(key: string): Promise<void>;
  protected abstract end(): Promise<void>;
  /** Where the element of a ref is, in CSS pixels of the document. */
  protected abstract box(ref: string): Promise<Area>;
  /** A call of the DevTools protocol, in the tab it acts in. */
  // deno-lint-ignore no-explicit-any
  protected abstract cdp(method: string, params: object): Promise<any>;

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
    const area = ref ? await this.box(ref) : clip ?? await this.evaluate<Area>(AREA(fullPage));
    const scale = maxSize ? Math.min(1, maxSize / Math.max(area.width, area.height)) : 1;
    const { data } = await this.cdp("Page.captureScreenshot", {
      format: type,
      ...type === "jpeg" && { quality },
      clip: { ...area, scale },
      captureBeyondViewport: true,
    });
    return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
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
    if (!dialog) throw new Error("No dialog is waiting");
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

  // for the drivers: what the page told
  protected logged(type: string, text: string) {
    this.#console.push({ type: type === "warn" ? "warning" : type, text });
    if (this.#console.length > KEEP) this.#console.shift(), this.#told = Math.max(0, this.#told - 1);
  }
  protected requested(request: Request) {
    this.#requests.push(request);
    if (this.#requests.length > KEEP) this.#requests.shift();
  }
  protected dialog(message: string, answer: (accept: boolean, text?: string) => Promise<void>) {
    this.#dialog = { message, answer };
    this.#opened.resolve();
    this.#opened = Promise.withResolvers();
  }
}
