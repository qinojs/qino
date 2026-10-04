import { App, s } from "@qino/qino";

export { api } from "./api.ts";

Object.assign(App.events, {
  "home:change": {
    description: "A home entity was observed to change, appear or disappear. Initial snapshots do not fire this event.",
    data: s.object({
      provider: s.string(),
      id: s.string().describe("Provider-local entity ID"),
      entity: s.any().describe("Current entity { id, name, state, attributes, available, updated? }, or null after removal"),
      previous: s.any().describe("Previous entity, or null when created"),
    }),
  },
});
