import { App, s } from "@qino/qino";

export { api } from "./api.ts";
export { default as dbSchema } from "./dbschema.json" with { type: "json" };

const report = s.object({
  provider: s.number(),
  id: s.string().describe("Provider-local entity ID"),
  entity: s.any().describe("Current entity { id, name, state, attributes, available, updated? }; null after removal"),
  previous: s.any().describe("Previous entity, or null when created"),
  changed: s.array(s.string()).describe("Paths of changed values: \"\" the state, attribute leaves joined by /"),
});

Object.assign(App.events, {
  "home:observe": {
    description: "A source observation, including snapshots and lost connections; does not imply a device change.",
    data: s.object({ provider: s.number(), id: s.string(), entity: s.any(), time: s.number() }),
  },
  "home:datapoint": { description: "A home datapoint was configured.", data: s.object({ id: s.number() }) },
  "home:provider": {
    description: "A provider instance was configured or retired. Credentials are never included.",
    data: s.object({ id: s.number(), adapter: s.string(), previousAdapter: s.optional(s.string()) }),
  },
  "home:input": {
    description: "A source reported an entity, whether or not a value changed: every press of a button. "
      + "Snapshots and lost connections do not fire this event.",
    data: report,
  },
  "home:change": {
    description: "A source reported an entity with changed values: `changed` lists their paths "
      + "(\"\" for the state, e.g. \"brightness\" for an attribute). "
      + "Snapshots and lost connections do not fire this event.",
    data: report,
  },
});
