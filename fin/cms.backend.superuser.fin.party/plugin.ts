import { backend } from "@qino/qino/cms.backend";
import { inFin } from "@qino/qino/cms.backend.superuser.fin";

import { render } from "./render.ts";
import api from "./nodeApi.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App } from "@qino/qino";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Customers & suppliers", de: "Kunden & Lieferanten" });
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render: inFin(render),
    api: inFin(api),
  },
};
