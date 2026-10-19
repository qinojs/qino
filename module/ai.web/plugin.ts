import { Access, ApiError, errMsg, s } from "@qino/qino";

import { crawl, pages, read, READERS, search, source } from "./mod.ts";

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
const PART = 2_000;

export const api: ApiTree = {
  search: {
    get: {
      description: "Search the web",
      query: s.object({
        query: s.string(),
        count: s.optional(s.number()).describe("At most 20; default 10"),
      }),
      access: Access.USER,
      execute: ({ query, count }: { query: string; count?: number }, ctx: Ctx) => search(ctx.app, query, { count }),
    },
  },
  read: {
    get: {
      description: "Read a web page as Markdown, or its source",
      query: s.object({
        url: s.string().describe("http or https"),
        maxAge: s.optional(s.number()).describe("Rarely needed: read anew if the stored copy is older than this many seconds"),
        offset: s.optional(s.number()).describe("In characters"),
        length: s.optional(s.number()).describe(`How many characters; default ${PART}; 0 gives none, only stores it for the pages tool`),
        source: s.optional(s.boolean()).describe("Its HTML source as served, instead of Markdown"),
      }),
      access: Access.USER,
      execute: async ({ url, maxAge, offset = 0, length = PART, source: raw }: { url: string; maxAge?: number; offset?: number; length?: number; source?: boolean }, ctx: Ctx) => {
        const page = await (raw ? source : read)(ctx.app, url, { maxAge });
        const content = String(page.content ?? "");
        return { ...page, content: content.slice(offset, offset + length), offset, size: content.length };
      },
    },
  },
  crawl: {
    post: {
      description: "Read the pages below a url, following their links; then find them with the pages tool, root: this url",
      input: s.object({
        url: s.string().describe("Where to start: only links that start with it are followed"),
        max: s.optional(s.number()).describe("Pages; default 100"),
        maxAge: s.optional(s.number()).describe("Rarely needed: read anew if the stored copy is older than this many seconds"),
        wait: s.optional(s.boolean()).describe("Answer when done, with how many were read and are left; else it runs in the background"),
      }),
      access: Access.USER,
      execute: ({ url, max, maxAge, wait }: { url: string; max?: number; maxAge?: number; wait?: boolean }, ctx: Ctx) => {
        if (!/^https?:\/\//i.test(url)) throw new ApiError(400, "url: http or https");
        const done = crawl(ctx.app, url, { max, maxAge });
        if (wait) return done;
        done.catch((e) => console.error("[ai.web] crawl:", errMsg(e)));
        return { started: url };
      },
    },
  },
  pages: {
    get: {
      description: "Search the pages already read and kept here (not the web); without search the latest",
      query: s.object({
        search: s.optional(s.string()),
        root: s.optional(s.string()).describe("Only pages whose url starts with it, e.g. where a crawl started"),
      }),
      access: Access.USER,
      execute: ({ search, root }: { search?: string; root?: string }, ctx: Ctx) => pages(ctx.app, search, { root }),
    },
  },
};
