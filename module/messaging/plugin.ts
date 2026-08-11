import dbSchema from "./dbschema.json" with { type: "json" };

export { dbSchema };

export const settingsSchema = {
  properties: {
    _secret: { type: "string", description: "Key for verification code hashes — generated on first use" },
  },
};
