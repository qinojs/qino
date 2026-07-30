import { Access, type AptTree, getCtx, type Params, s, unixTime } from "../core/mod.ts";

export const api: AptTree = {
  clients: {
    get: {
      description: "List registered OAuth clients",
      access: Access.SUPERUSER,
      execute: () => getCtx().app.db.query`SELECT id, name, redirect_uris, created, dynamic FROM oauth_client ORDER BY created DESC`,
    },
    post: {
      description: "Register an OAuth client with a fixed client_id (for clients that cannot self-register)",
      access: Access.SUPERUSER,
      input: s.object({
        id: s.string().describe("client_id the client will send"),
        name: s.optional(s.string()),
        redirect_uris: s.array(s.string()).describe("Exact redirect targets; no wildcards"),
      }),
      execute: async ({ id, name, redirect_uris }: Params) => {
        const ctx = getCtx();
        await ctx.app.db.table("oauth_client").insert({
          id: String(id),
          name: String(name ?? id),
          redirect_uris: (redirect_uris as string[]).join("\n"),
          created: unixTime(),
          dynamic: 0,
        });
        return { id };
      },
    },
  },
  client: {
    ":id": {
      paramSchema: s.string(),
      delete: {
        description: "Delete a client and every token issued to it",
        access: Access.SUPERUSER,
        execute: async ({ id }: Params) => {
          const ctx = getCtx();
          await ctx.app.db.exec`DELETE FROM oauth_token WHERE client_id = ${String(id)}`;
          return { ok: await ctx.app.db.table("oauth_client").delete(String(id)) };
        },
      },
    },
  },
  grants: {
    get: {
      description: "List the clients that currently hold tokens for the signed-in user",
      access: Access.USER,
      execute: () => {
        const ctx = getCtx();
        return ctx.app.db.query`SELECT t.client_id, c.name, MIN(t.created) AS since, MAX(t.expires) AS until
          FROM oauth_token t LEFT JOIN oauth_client c ON c.id = t.client_id
          WHERE t.usr_id = ${ctx.userId} AND t.kind <> ${"code"}
          GROUP BY t.client_id, c.name ORDER BY since DESC`;
      },
    },
  },
  grant: {
    ":clientId": {
      paramSchema: s.string(),
      delete: {
        description: "Revoke every token the signed-in user granted to a client",
        access: Access.USER,
        execute: async ({ clientId }: Params) => {
          const ctx = getCtx();
          await ctx.app.db.exec`DELETE FROM oauth_token WHERE usr_id = ${ctx.userId} AND client_id = ${String(clientId)}`;
          return { ok: true };
        },
      },
    },
  },
};
