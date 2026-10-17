import { Access, AccessError, s } from "@qino/qino";

import { whose, WHOSE } from "./mod.ts";

import type { ApiTree, Ctx, Params } from "@qino/qino";

/** A user's columns of fin by their schema.org names: the postal address and the IBAN. */
const COLUMNS = {
  streetAddress: "street_address",
  postalCode: "postal_code",
  addressLocality: "address_locality",
  addressRegion: "address_region",
  addressCountry: "address_country",
  iban: "iban",
} as const;

/** A user keeps their own address, where invoices go; a superuser anyone's. */
export const api: ApiTree = {
  address: {
    get: {
      description: "The postal address invoices go to (schema.org PostalAddress) and the IBAN to pay into",
      access: Access.USER,
      query: s.object({ usrId: WHOSE.usrId }),
      execute: async ({ usrId }: Params, ctx: Ctx) => {
        const usr = await ctx.app.db.row`SELECT * FROM usr WHERE id = ${whose(ctx, { usrId })}`;
        return Object.fromEntries(Object.entries(COLUMNS).map(([key, column]) => [key, usr?.[column] ?? null]));
      },
    },
    put: {
      description: "Change it; fields left out stay, an empty one is cleared. Issued invoices keep theirs. "
        + "The IBAN only a superuser sets",
      access: Access.USER,
      input: s.object({
        usrId: WHOSE.usrId,
        ...Object.fromEntries(Object.keys(COLUMNS).map((key) => [key, s.optional(s.string())])),
      }),
      execute: async ({ usrId, ...values }: Params, ctx: Ctx) => {
        // the IBAN finds the supplier of a received invoice: set by a user, it would take over another's
        if (values.iban !== undefined && !ctx.user?.superuser) throw new AccessError("the IBAN is a superuser's");
        const clean = (key: string, value: string) =>
          key === "addressCountry" ? value.trim().toUpperCase()
          : key === "iban" ? value.replace(/\s+/g, "").toUpperCase() || null
          : value.trim();
        const fields = Object.fromEntries(Object.entries(COLUMNS).filter(([key]) => values[key] !== undefined)
          .map(([key, column]) => [column, clean(key, String(values[key]))]));
        const usr = Number(whose(ctx, { usrId }));
        if (Object.keys(fields).length) await ctx.app.db.table("usr").update(usr, fields);
        return { ok: true };
      },
    },
  },
};
