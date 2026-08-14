export { default as dbSchema } from "./dbschema.json" with { type: "json" };

export const settingsSchema = {
  properties: {
    _secret: { type: "string", description: "Key for verification code hashes — generated on first use" },
  },
};
