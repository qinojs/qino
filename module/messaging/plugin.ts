import dbSchema from "./dbschema.json" with { type: "json" };

export const name = "messaging";
export const description = "Shared journal, channel registry and contact verification for the messaging channels.";
export const needs = ["core"];
export { dbSchema };

export const settingsSchema = {
  properties: {
    _secret: { type: "string", description: "Key for verification code hashes — generated on first use" },
  },
};
