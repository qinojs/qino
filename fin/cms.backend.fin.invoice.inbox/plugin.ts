import { backend } from "@qino/qino/cms.backend";
import { finTexts, inFin } from "@qino/qino/cms.backend.fin";

import { render, widget } from "./render.ts";
import api from "./nodeApi.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.takeOver(app, "cms.backend.superuser.fin.invoice.inbox", name);
  await backend.install(app, name, { en: "Inbox", de: "Eingang" });
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render: inFin(render),
    api: inFin(api),
  },
};

export const backendDashboardWidget = (app: App, page: Node): Promise<HtmlString> => finTexts(app, () => widget(app, page));
