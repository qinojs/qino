import { connection } from "./connection.ts";

import type { Adapter } from "@qino/qino/home";

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["url", "accessToken"],
  title: "Home Assistant",
  properties: {
    url: {
      type: "string", minLength: 1, title: "URL", format: "uri", pattern: "^(?:https?|wss?)://[^\\s@/?#]+(?:[/?#]|$)",
      description: "Home Assistant base URL, including a reverse proxy path if needed",
    },
    accessToken: {
      type: "string", minLength: 1, title: "Access token", writeOnly: true,
      description: "Server-side long-lived Home Assistant access token",
    },
  },
};

export const homeProvider: Adapter = {
  name: "homeassistant", schema,
  entities: async (app, id) => connection(app, id).entities(),
  actions: async (app, id) => connection(app, id).actions(),
  call: async (app, id, action, input) => connection(app, id).call(action, input),
  history: async (app, id, entity, period) => connection(app, id).history(entity, period),
};
