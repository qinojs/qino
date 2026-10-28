import { Access, s } from "@qino/qino";

import type { ApiTree, Ctx, Params } from "@qino/qino";

/** A user's columns by their schema.org names. */
const COLUMNS = {
  givenName: "given_name",
  familyName: "family_name",
  organization: "organization",
  streetAddress: "street_address",
  postalCode: "postal_code",
  addressLocality: "address_locality",
  addressRegion: "address_region",
  addressCountry: "address_country",
} as const;

/** Each user keeps their own; someone else's is the backend's. */
export const api: ApiTree = {
  get: {
    description: "One's own profile: name, organization and postal address (schema.org)",
    access: Access.USER,
    execute: async (_: Params, ctx: Ctx) => {
      const usr = await ctx.app.db.row`SELECT * FROM usr WHERE id = ${ctx.userId}`;
      return Object.fromEntries(Object.entries(COLUMNS).map(([key, column]) => [key, usr?.[column] ?? null]));
    },
  },
  put: {
    description: "Change it; fields left out stay, an empty one is cleared",
    access: Access.USER,
    input: s.object(Object.fromEntries(Object.keys(COLUMNS).map((key) => [key, s.optional(s.string())]))),
    execute: async (values: Params, ctx: Ctx) => {
      const clean = (key: string, value: string) => key === "addressCountry" ? value.trim().toUpperCase() : value.trim();
      const fields = Object.fromEntries(Object.entries(COLUMNS).filter(([key]) => values[key] !== undefined)
        .map(([key, column]) => [column, clean(key, String(values[key]))]));
      if (Object.keys(fields).length) await ctx.app.db.table("usr").update(ctx.userId, fields);
      return { ok: true };
    },
  },
};

