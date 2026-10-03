import { Access, ApiError, errMsg, s } from "@qino/qino";

import { crawl, pages, read, READERS, search } from "./mod.ts";

import type { ApiTree, Ctx } from "@qino/qino";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

export const settingsSchema = {
  properties: {
    reader: {
      type: "string", enum: Object.keys(READERS), default: "fetch",
      description: "Who reads pages: our own fetch, or a service with its key in core.keys.",
    },
  },
};

// Searching and reading cost: signed-in users only.

/** How many characters of a page `read` gives at once: a model's context is limited. */
const PART = 20_000;

export const api: ApiTree = {
  search: {
    get: {
      description: "Search the web: the pages found, each with title, url and a snippet",
      query: s.object({
        query: s.string().describe("What to find"),
        count: s.optional(s.number()).describe("How many pages, at most 20; default 10"),
      }),
      access: Access.USER,
      execute: ({ query, count }: { query: string; count?: number }, ctx: Ctx) => search(ctx.app, query, { count }),
    },
  },
  read: {
    get: {
      description: "Read a web page as Markdown, a part at a time; size is the whole page",
      query: s.object({
        url: s.string().describe("The page's address, http or https"),
        maxAge: s.optional(s.number()).describe("Read again if older than this many seconds; default a day, 0 always"),
        offset: s.optional(s.number()).describe("Where to start, in characters; default 0"),
        length: s.optional(s.number()).describe(`How many characters; default ${PART}, 0 only keeps it to search`),
      }),
      access: Access.USER,
      execute: async ({ url, maxAge, offset = 0, length = PART }: { url: string; maxAge?: number; offset?: number; length?: number }, ctx: Ctx) => {
        const page = await read(ctx.app, url, { maxAge });
        const content = String(page.content ?? "");
        return { ...page, content: content.slice(offset, offset + length), offset, size: content.length };
      },
    },
  },
  crawl: {
    post: {
      description: "Read the pages below a url, following their links; then search them with pages and root",
      input: s.object({
        url: s.string().describe("Where to start: only links that start with it are followed"),
        max: s.optional(s.number()).describe("How many pages at most; default 100"),
        maxAge: s.optional(s.number()).describe("Read a page again if older than this many seconds; default a day, 0 always"),
        wait: s.optional(s.boolean()).describe("Answer when done, with how many were read and are left; else it runs in the background"),
      }),
      access: Access.USER,
      execute: ({ url, max, maxAge, wait }: { url: string; max?: number; maxAge?: number; wait?: boolean }, ctx: Ctx) => {
        if (!/^https?:\/\//i.test(url)) throw new ApiError(400, "url: http or https");
        const done = crawl(ctx.app, url, { max, maxAge });
        if (wait) return done;
        done.catch((e) => console.error("[ai1.web] crawl:", errMsg(e)));
        return { started: url };
      },
    },
  },
  pages: {
    get: {
      description: "Search the pages already read and kept here (not the web), by meaning; without search the latest",
      query: s.object({
        search: s.optional(s.string()).describe("What to find, in words"),
        root: s.optional(s.string()).describe("Only pages whose url starts with it, e.g. where a crawl started"),
      }),
      access: Access.USER,
      execute: ({ search, root }: { search?: string; root?: string }, ctx: Ctx) => pages(ctx.app, search, { root }),
    },
  },
};
