// Test-only surface of score: the manifest schema, so other modules' tests can build the tables
// without importing score/plugin.ts.
export { dbSchema } from "../plugin.ts";
