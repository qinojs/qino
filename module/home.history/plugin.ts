import { App, s } from "@qino/qino";

export { api } from "./api.ts";

Object.assign(App.events, { "home.history:read": {
  description: "A local measurement archive may answer before upstream history is consulted; "
    + "an empty array is an answered query.",
  data: s.object({
    datapoint: s.number(), start: s.number(), end: s.number(), source: s.string(), limit: s.number(),
    width: s.optional(s.number()), consumption: s.optional(s.boolean()), maxGap: s.optional(s.number()),
    data: s.optional(s.any()),
  }),
} });
