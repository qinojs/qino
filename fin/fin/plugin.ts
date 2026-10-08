export { default as dbSchema } from "./dbschema.json" with { type: "json" };
export { api } from "./api.ts";

export const settingsSchema = {
  properties: {
    mainCurrency: {
      type: "string",
      maxLength: 3,
      description: "The main currency, ISO 4217: the books keep it, new forms suggest it. "
        + "Empty: the one of the country the organization is in (identity)",
    },
  },
};
