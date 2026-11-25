import { backend } from "@qino/qino/cms.backend";
import { finTexts, inFin } from "@qino/qino/cms.backend.fin";

import api from "./nodeApi.ts";
import { render, userDomains, widget } from "./render.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.takeOver(app, "cms.backend.superuser.fin.hosting", name);
  await backend.install(app, name, { en: "Domains & hosting", de: "Domains & Hosting" });
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render: inFin(render),
    api: inFin(api),
  },
};

export const backendDashboardWidget = (app: App, page: Node): Promise<HtmlString> => finTexts(app, () => widget(app, page));

export const backendRowWidget = {
  usr: (app: App, id: unknown, page: Node): Promise<HtmlString | string> => finTexts(app, () => userDomains(app, id, page)),
};
