import { Access, s } from "@qino/qino";

import { whose, WHOSE } from "./mod.ts";

import type { ApiTree, Ctx, Params } from "@qino/qino";

/** The IBAN a user is paid into; the postal address is user.profile's. */
export const api: ApiTree = {
  iban: {
    get: {
      description: "The IBAN a user is paid into",
      access: Access.USER,
      query: s.object({ usrId: WHOSE.usrId }),
      execute: async ({ usrId }: Params, ctx: Ctx) => ({
        iban: await ctx.app.db.one`SELECT iban FROM usr WHERE id = ${whose(ctx, { usrId })}` ?? null,
      }),
    },
    put: {
      // it finds the supplier of a received invoice: set by a user, it would take over another's
      description: "Set it, without spaces; it finds the supplier of a received invoice",
      access: Access.SUPERUSER,
      input: s.object({ usrId: s.number().describe("The user"), iban: s.string() }),
      execute: async ({ usrId, iban }: Params, ctx: Ctx) => {
        const value = String(iban).replace(/\s+/g, "").toUpperCase() || null;
        await ctx.app.db.table("usr").update(Number(usrId), { iban: value });
        return { ok: true };
      },
    },
  },
};
