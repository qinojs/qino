import dbSchema from "./dbschema.json" with { type: "json" };

export const name = "api_key";
export const needs = ["core"];
export { api } from "./apt.ts";
export { dbSchema };

// Key management (create / list / revoke) works out of the box via the session-authenticated
// API. Using a key as a Bearer credential to call the API needs a small, generic core hook —
// see USAGE.md → "Activating bearer auth". No hidden request-mutation happens here on purpose.
