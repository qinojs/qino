import { Access, AccessError, type ApiTree, getCtx, type Params, s, unixTime } from "../core/mod.ts";
import { generateToken, hashToken, keyPrefix } from "./lib/keys.ts";

export const api: ApiTree = {
  keys: {
    get: {
      description: "List own API keys (never the token itself)",
      access: Access.USER,
      execute: async () => {
        const ctx = getCtx();
        const rows = await ctx.app.db.query`SELECT id, name, prefix, created, expires FROM api_key WHERE usr_id = ${ctx.userId} ORDER BY created DESC`;
        return rows.map((r) => ({ id: r.id, name: r.name, prefix: r.prefix, created: r.created, expires: r.expires }));
      },
    },
    post: {
      description: "Create an API key — the token is returned only once and never stored in clear",
      access: Access.USER,
      input: s.object({ name: s.optional(s.string()), expires: s.optional(s.number()).describe("Unix seconds; omit for no expiry") }),
      execute: async ({ name, expires }: Params) => {
        const ctx = getCtx();
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
  },
  key: {
    ":id": {
      paramSchema: s.number(),
      delete: {
        description: "Delete (revoke) an API key — own, or any as superuser",
        access: Access.USER,
        execute: async ({ id }: Params) => {
          const ctx = getCtx();
          const row = await ctx.app.db.row`SELECT usr_id FROM api_key WHERE id = ${id}`;
          if (!row) return { ok: false };
          if (Number(row.usr_id) !== ctx.userId && !(await ctx.user?.get("superuser"))) throw new AccessError();
          await ctx.app.db.table("api_key").delete(id);
          return { ok: true };
        },
      },
    },
  },
};
