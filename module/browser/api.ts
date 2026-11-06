import { Access, ApiError, NotFoundError, s, sys, uid } from "@qino/qino";

import { open } from "./mod.ts";

import type { ApiTree, App, Ctx, StandardSchema } from "@qino/qino";
import type { Page } from "./mod.ts";

/** A page opened through the api closes itself after this long unused. */
const IDLE = 10 * 60_000;
/** How long an action waits for its element. */
const WAIT = 10_000;
const REF = s.string().describe("From the snapshot, e.g. e12");

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

/** What a page shows once what an action started is done: its accessibility tree with refs to act by, and
 *  what it told meanwhile. A waiting dialog holds the page: then only it. */
async function state(id: string, page: Page) {
  await page.waitForLoadState();
  const news = await page.news();
  if (news.dialog) return { id, url: page.url(), ...news };
  return { id, url: page.url(), title: await page.title(), snapshot: await page.snapshot(), ...news };
}

/** An action on the user's page by its id, answered with what the page shows then; a dialog it opens ends the
 *  waiting for it. */
function action(
  description: string,
  shape: Record<string, StandardSchema<unknown>>,
  // deno-lint-ignore no-explicit-any
  act: (page: Page, args: any) => Promise<unknown>,
) {
  return {
    post: {
      description,
      input: s.object({ id: s.string(), ...shape }),
      access: Access.USER,
      execute: async ({ id, ...args }: { id: string }, ctx: Ctx) => {
        const page = session(ctx, id), done = act(page, args);
        done.catch(() => {}); // after a dialog nobody waits for it
        await Promise.race([done, page.dialogOpened()]);
        return state(id, page);
      },
    },
  };
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
        // a page that does not load is closed: there is no id yet to close it by
        if (url) await page.goto(url).catch(async (e) => (await page.close(), Promise.reject(e)));
        of(ctx.app).set(id, { usrId: ctx.userId, page });
        page.on("close", () => of(ctx.app).delete(id));
        session(ctx, id);
        return state(id, page);
      },
    },
  },
  goto: action("Go to an address", { url: s.string().describe("http or https") },
    (page, { url }) => page.goto(web(url))),
  back: action("Go back to the page before", {},
    (page) => page.goBack()),
  click: action("Click an element", { ref: REF },
    (page, { ref }) => page.click(ref)),
  fill: action("Fill a text field, replacing what it holds", { ref: REF, text: s.string() },
    (page, { ref, text }) => page.fill(ref, text)),
  select: action("Choose in a list (select)", {
    ref: REF,
    values: s.array(s.string()).describe("The values or labels"),
  }, (page, { ref, values }) => page.selectOption(ref, values)),
  hover: action("Move the mouse over an element", { ref: REF },
    (page, { ref }) => page.hover(ref)),
  press: action("Press a key, e.g. Enter, Tab, PageDown", { key: s.string() },
    (page, { key }) => page.keyboard.press(key)),
  tab: action("Act in another tab", { index: s.number().describe("From the tabs, 0 the first") },
    (page, { index }) => page.tab(index)),
  dialog: action("Answer the dialog (alert, confirm, prompt)", {
    accept: s.boolean(),
    text: s.optional(s.string()).describe("For a prompt"),
  }, (page, { accept, text }) => page.handleDialog(accept, text)),
  snapshot: {
    get: {
      description: "What the page shows now",
      query: s.object({ id: s.string() }),
      access: Access.USER,
      execute: ({ id }: { id: string }, ctx: Ctx) => state(id, session(ctx, id)),
    },
  },
  screenshot: {
    get: {
      description: "How the page looks: the visible part, all of it, or one element",
      query: s.object({ id: s.string(), fullPage: s.optional(s.boolean()), ref: s.optional(REF) }),
      access: Access.USER,
      execute: async ({ id, fullPage, ref }: { id: string; fullPage?: boolean; ref?: string }, ctx: Ctx) => {
        const png = await session(ctx, id).screenshot({ fullPage, ref });
        return { type: "image", url: `data:image/png;base64,${png.toBase64()}` }; // as ai's Part
      },
    },
  },
  console: {
    get: {
      description: "The page's console: messages and errors since it opened",
      query: s.object({ id: s.string() }),
      access: Access.USER,
      execute: ({ id }: { id: string }, ctx: Ctx) => session(ctx, id).consoleMessages(),
    },
  },
  network: {
    get: {
      description: "The requests the page did",
      query: s.object({ id: s.string(), failed: s.optional(s.boolean()).describe("Only those that failed") }),
      access: Access.USER,
      execute: ({ id, failed }: { id: string; failed?: boolean }, ctx: Ctx) =>
        session(ctx, id).requests().filter((r) => !failed || r.error || (r.status ?? 0) >= 400),
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
