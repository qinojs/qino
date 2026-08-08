import dbSchema from "./dbschema.json" with { type: "json" };

export const name = "messaging";
export const description = "Shared journal for incoming and outgoing messages.";
export const needs = ["core"];
export { dbSchema };
