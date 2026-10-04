import { ApiError } from "@qino/qino";
import { datapoints } from "@qino/qino/home";

import type { Adapter } from "@qino/qino/home";

/** Manual observations use the same datapoint metadata and archive as connected sources. */
export const homeProvider: Adapter = {
  name: "manual",
  schema: {
    type: "object", title: "Manual", additionalProperties: false,
    properties: { url: { type: "string", maxLength: 0, "x-html": { type: "hidden" } } },
  },
  entities: async (app, id) => (await datapoints(app, id)).map((point) => ({
    id: point.entity, name: point.name, state: point.value, unit: point.unit, attributes: {},
    available: point.value !== null, ...(point.time === null ? {} : { updated: new Date(point.time).toISOString() }),
  })),
  actions: async () => [],
  call: () => Promise.reject(new ApiError(501, "Manual observations have no device actions")),
};
