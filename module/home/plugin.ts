import { App, s } from "@qino/qino";

export { api } from "./api.ts";
export { default as dbSchema } from "./dbschema.json" with { type: "json" };

Object.assign(App.events, {
  "home:observe": { description: "A typed source observation, including initial snapshots; does not imply a change.", data: s.object({ provider: s.number(), id: s.string(), entity: s.any(), time: s.number() }) },
  "home:datapoint": { description: "A home datapoint was configured.", data: s.object({ id: s.number() }) },
  "home:provider": {
    description: "A provider instance was configured or retired. Credentials are never included.",
    data: s.object({ id: s.number(), adapter: s.string(), previousAdapter: s.optional(s.string()) }),
  },
  "home:change": {
    description: "A home entity was observed to change, appear or disappear. Initial snapshots do not fire this event.",
    data: s.object({
      provider: s.number(),
      id: s.string().describe("Provider-local entity ID"),
      entity: s.any().describe("Current entity { id, name, state, attributes, available, updated? }, or null after removal"),
      previous: s.any().describe("Previous entity, or null when created"),
    }),
  },
});
