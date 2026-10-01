import { Access, s } from "@qino/qino";

import { pages, read, search } from "./mod.ts";

import type { ApiTree, Ctx } from "@qino/qino";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

export const settingsSchema = {
  properties: {
    reader: {
      type: "string", enum: ["fetch", "jina", "firecrawl"], default: "fetch",
      description: "Who reads pages: our own fetch, or a service with its key in core.keys.",
    },
  },
};

// Searching and reading cost: signed-in users only.

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
      description: "Read a web page as Markdown, from the pages read if it is recent",
      query: s.object({
        url: s.string().describe("The page's address, http or https"),
        maxAge: s.optional(s.number()).describe("Read again if older than this many seconds; default a day, 0 always"),
      }),
      access: Access.USER,
      execute: ({ url, maxAge }: { url: string; maxAge?: number }, ctx: Ctx) => read(ctx.app, url, { maxAge }),
    },
  },
  pages: {
    get: {
      description: "The pages read, the latest first; with search those nearest to it by meaning, with the closest part",
      query: s.object({ search: s.optional(s.string()).describe("What to find, in words") }),
      access: Access.USER,
      execute: ({ search }: { search?: string }, ctx: Ctx) => pages(ctx.app, search),
    },
  },
};
