// A library module: no route and no setting of its own. What it offers other modules is in
// ./mod.ts, what it collects from them is their `authFactor` export. The one table it owns holds
// the secrets of factors too small to deserve their own.
export { default as dbSchema } from "./dbschema.json" with { type: "json" };
