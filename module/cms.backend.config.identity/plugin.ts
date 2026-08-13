import { backend } from "@qino/qino/cms.backend";
import { html, type App, type HtmlString } from "@qino/qino";
import api from "./nodeApi.ts";
import { render } from "./render.ts";
import manifest from "./manifest.json" with { type: "json" };
const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Identity", de: "Identität" });
}

export async function uninstall({ app }: { app: App }): Promise<void> {
  await backend.uninstall(app, name);
}

export async function backendDashboardWidget(app: App): Promise<HtmlString> {
  const identity = app.settings.identity;
  const name = String(await identity.name ?? "");
  const organization = String(await identity.organization.name ?? "");
  const contact = String(await identity.contact.email ?? "");
  return html`<div style="padding:1rem">
  <strong>${name || "—"}</strong>
  ${organization ? html`<div>${organization}</div>` : ""}
  ${contact ? html`<div>${contact}</div>` : ""}
</div>`;
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render,
    api,
  },
};
