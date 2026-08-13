import { Access, getCtx, s } from "@qino/qino";

import type { ApiTree, Params } from "@qino/qino";

/** Self-service only — a user sees and revokes their own grants. Managing clients is an
 *  administrative job and lives in the backend module, not in the public API tree. */
export const api: ApiTree = {
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
