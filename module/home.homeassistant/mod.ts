import { connection } from "./connection.ts";

import type { Provider } from "@qino/qino/home";

export const homeProvider: Provider = {
  name: "homeassistant",
  entities: async (app) => connection(app).entities(),
  actions: async (app) => connection(app).actions(),
  call: async (app, action, input) => connection(app).call(action, input),
  history: async (app, entity, period) => connection(app).history(entity, period),
};
