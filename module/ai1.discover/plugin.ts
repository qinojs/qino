import { Access, NotFoundError, s } from "@qino/qino";

import { entries, find } from "./lib/discover.ts";

import type { ApiTree, Ctx } from "@qino/qino";
import type { Kind } from "./lib/discover.ts";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

// A search embeds its query, which costs: signed-in users only. Nothing here is secret.

/** A kind's list, searchable, and each of it by name. */
const kind = (kind: Kind, param: string, what: string, detail: string) => ({
  get: {
    description: `${what}: name and description of each; with search only those nearest to it by meaning`,
    query: s.object({ search: s.optional(s.string()).describe("What to find, in words") }),
    access: Access.USER,
    execute: async ({ search }: { search?: string }, ctx: Ctx) =>
      (search ? await find(ctx, kind, search) : await entries(ctx, kind)).map(({ name, description }) => ({ name, description })),
  },
  [":" + param]: {
    paramSchema: s.string(),
    get: {
      description: detail,
      access: Access.USER,
      execute: async (params: Record<string, string>, ctx: Ctx) => {
        const entry = (await entries(ctx, kind)).find((e) => e.name === params[param]);
        if (!entry) throw new NotFoundError(`No such ${param}`);
        return entry.detail;
      },
    },
  },
});

export const api: ApiTree = {
  tables: kind("tables", "table", "The database tables", "The table's schema: its columns with type and description"),
  events: kind("events", "event", "The events, as host:event (db:table:update-after)", "The event: its description and data as JSON Schema"),
  tools: kind("tools", "tool", "The tools you may call", "The tool: its description and parameters"),
};
