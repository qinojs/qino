import dbSchema from "./dbschema.json" with { type: "json" };

export const name = "ticket";
export const description = "One-time secrets: confirmation links and the actions behind them.";
export const needs = ["core"];
export { dbSchema };

export const settingsSchema = {
  properties: {
    // not made at install: reinstalling would replace it and every outstanding ticket would die
    _secret: { type: "string", description: "Key the ticket hashes are made with — generated on first use" },
  },
};
