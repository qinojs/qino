import { backend } from "@qino/qino/cms.backend";
import { finTexts, inFin } from "@qino/qino/cms.backend.superuser.fin";

import { partyCard, render } from "./render.ts";
import api from "./nodeApi.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

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

export const backendRowWidget = {
  usr: (app: App, id: unknown, page: Node) => finTexts(app, () => partyCard(app, id, page)),
};
