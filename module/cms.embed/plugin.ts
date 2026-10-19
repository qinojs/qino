import { Access, s } from "@qino/qino";

import { find, sync } from "./mod.ts";

import type { ApiTree, App, Ctx } from "@qino/qino";
import type { Jobs } from "@qino/qino/cron";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

export const settingsSchema = {
  properties: {
    auto: { type: "boolean", default: false, description: "Reindex changed CMS texts each hour." },
  },
};

export const cron = {
  sync: { every: "hour", run: async (app: App) => { if (await app.settings["cms.embed"].auto) await sync(app); } },
} satisfies Jobs;

// A search embeds its query, which costs: signed-in users only.
export const api: ApiTree = {
  search: {
    get: {
      description: "Find CMS pages by meaning, in the current language: by their texts and the files on them; only pages you may read. The best first, each with its best matching text",
      query: s.object({
        search: s.string().describe("Vector search"),
        start: s.optional(s.number().describe("Only this page and those below it")),
        limit: s.optional(s.number().describe("At most this many pages, 20 if not given, at most 50")),
      }),
      access: Access.USER,
      execute: async ({ search, start, limit }: { search: string; start?: number; limit?: number }, ctx: Ctx) =>
        Promise.all((await find(ctx, search, { start, limit: Math.min(limit ?? 20, 50) })).map(async ({ page, content, score }) => ({
          id: page.id, title: await page.title(ctx.lang), url: await page.url(), content, score,
        }))),
    },
  },
};
