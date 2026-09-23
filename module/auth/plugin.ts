// Library module without routes or settings. API in ./mod.ts; collects the `authFactors` exports.
// Its table holds secrets of factors without an own table.
export { default as dbSchema } from "./dbschema.json" with { type: "json" };
