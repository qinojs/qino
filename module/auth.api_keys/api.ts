import { Access, AccessError, s, unixTime } from "@qino/qino";

import { generateToken, hashToken, keyPrefix } from "./lib/keys.ts";

import type { ApiTree, Params, Ctx } from "@qino/qino";

export const api: ApiTree = {
  get: {
    description: "List own API keys (never the token itself)",
    access: Access.USER,
    execute: async (_: unknown, ctx: Ctx) => {
      const rows = await ctx.app.db.query`SELECT id, name, prefix, created, expires FROM api_key WHERE usr_id = ${ctx.userId} ORDER BY created DESC`;
      return rows;
    },
  },
  post: {
    description: "Create an API key — the token is returned only once and never stored in clear",
    access: Access.USER,
    requireStepUp: true,
    input: s.object({ name: s.optional(s.string()), expires: s.optional(s.number()).describe("Unix seconds; omit for no expiry") }),
    execute: async ({ name, expires }: Params, ctx: Ctx) => {
      const token = generateToken();
      const id = await ctx.app.db.table("api_key").insert({
        usr_id: ctx.userId,
        name: String(name ?? "API Key"),
        prefix: keyPrefix(token),
        hash: hashToken(token),
        created: unixTime(),
        expires: expires ? Number(expires) : null,
      });
      return { id, token };
    },
  },

  ":id": {
    paramSchema: s.number(),
    delete: {
      description: "Delete (revoke) an API key — own, or any as superuser",
      access: Access.USER,
      execute: async ({ id }: Params, ctx: Ctx) => {
        const row = await ctx.app.db.row`SELECT usr_id FROM api_key WHERE id = ${id}`;
        if (!row) return { ok: false };
        if (Number(row.usr_id) !== ctx.userId && !ctx.user?.superuser) throw new AccessError();
        await ctx.app.db.table("api_key").delete(id);
        return { ok: true };
      },
    },
  },
};
