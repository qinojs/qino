import { Access, ApiError, NotFoundError, s, sys, uid } from "@qino/qino";

import { Chrome } from "./lib/puppeteer.ts";
import { executable, open } from "./mod.ts";

import type { ApiTree, App, Ctx } from "@qino/qino";
import type { Page } from "./mod.ts";

export const settingsSchema = {
  properties: {
    executable: { type: "string", description: "Chromium to run; the first one installed by default" },
  },
};

export function healthChecks(app: App) {
  return { warning: {
    "no browser": async () => {
      if (!await executable(app)) return { info: "install Chromium (apt install chromium) or set browser.executable" };
      const missing = await Chrome.missing();
      if (missing) return { info: missing };
    },
  } };
}

/** A page opened through the api closes itself after this long unused. */
const IDLE = 10 * 60_000;
/** How long an action waits for its element. */
const WAIT = 10_000;

type Session = { usrId: number; page: Page; idle?: ReturnType<typeof setTimeout> };
const sessions = new WeakMap<App, Map<string, Session>>();
const of = (app: App) => sessions.get(app) ?? sessions.set(app, new Map()).get(app)!;

const web = (url: string) => {
  if (!/^https?:\/\//i.test(url)) throw new ApiError(400, "url: http or https");
  return url;
};

/** The user's own page by its id, kept open for another while. */
function session(ctx: Ctx, id: string) {
  const one = of(ctx.app).get(id);
  if (!one || one.usrId !== ctx.userId) throw new NotFoundError(`No page ${id}, or closed`);
  clearTimeout(one.idle);
  one.idle = setTimeout(() => void one.page.close().catch(() => {}), IDLE);
  sys.unrefTimer(one.idle);
  return one.page;
}

/** What a page shows: its accessibility tree, each element with a ref to act on. */
async function state(id: string, page: Page) {
  const snapshot = await page.snapshot(); // first: it waits for what an action started
  return { id, url: page.url(), title: await page.title(), snapshot };
}

// Pages from the api are guarded: users and agents reach only public addresses.
export const api: ApiTree = {
  open: {
    post: {
      description: "Open a page in a browser of your own; act on it with its id, close it when done",
      input: s.object({ url: s.optional(s.string()).describe("http or https") }),
      access: Access.USER,
      execute: async ({ url }: { url?: string }, ctx: Ctx) => {
        if (url) web(url);
        const page = await open(ctx.app), id = uid();
        page.setDefaultTimeout(WAIT);
        if (url) await page.goto(url).catch(async (e) => (await page.close(), Promise.reject(e))); // no id to close it by
        of(ctx.app).set(id, { usrId: ctx.userId, page });
        page.on("close", () => of(ctx.app).delete(id));
        session(ctx, id);
        return state(id, page);
      },
    },
  },
  goto: {
    post: {
      description: "Go to an address",
      input: s.object({ id: s.string(), url: s.string().describe("http or https") }),
      access: Access.USER,
      execute: async ({ id, url }: { id: string; url: string }, ctx: Ctx) => {
        const page = session(ctx, id);
        await page.goto(web(url));
        return state(id, page);
      },
    },
  },
  click: {
    post: {
      description: "Click an element",
      input: s.object({ id: s.string(), ref: s.string().describe("From the snapshot, e.g. e12") }),
      access: Access.USER,
      execute: async ({ id, ref }: { id: string; ref: string }, ctx: Ctx) => {
        const page = session(ctx, id);
        await page.click(ref);
        return state(id, page);
      },
    },
  },
  fill: {
    post: {
      description: "Fill a text field, replacing what it holds",
      input: s.object({ id: s.string(), ref: s.string().describe("From the snapshot, e.g. e12"), text: s.string() }),
      access: Access.USER,
      execute: async ({ id, ref, text }: { id: string; ref: string; text: string }, ctx: Ctx) => {
        const page = session(ctx, id);
        await page.fill(ref, text);
        return state(id, page);
      },
    },
  },
  press: {
    post: {
      description: "Press a key, e.g. Enter, Tab, ArrowDown",
      input: s.object({ id: s.string(), key: s.string() }),
      access: Access.USER,
      execute: async ({ id, key }: { id: string; key: string }, ctx: Ctx) => {
        const page = session(ctx, id);
        await page.keyboard.press(key);
        return state(id, page);
      },
    },
  },
  snapshot: {
    get: {
      description: "What the page shows now",
      query: s.object({ id: s.string() }),
      access: Access.USER,
      execute: ({ id }: { id: string }, ctx: Ctx) => state(id, session(ctx, id)),
    },
  },
  close: {
    post: {
      description: "Close the page",
      input: s.object({ id: s.string() }),
      access: Access.USER,
      execute: async ({ id }: { id: string }, ctx: Ctx) => {
        await session(ctx, id).close();
        return { closed: id };
      },
    },
  },
};
