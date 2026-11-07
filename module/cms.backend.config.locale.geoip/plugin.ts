import { getCtx, html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { geoip, NAMES } from "@qino/qino/locale.geoip";

import api from "./nodeApi.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "IP to country", de: "IP zu Land" });
}
export async function uninstall({ app }: { app: App }): Promise<void> {
  await backend.uninstall(app, name);
}

const LABELS: Record<string, string> = { dbip: "DB-IP Lite", rir: "Regional Internet Registries" };

const showTime = (ms?: number) => ms ? new Date(ms).toISOString().slice(0, 16).replace("T", " ") : "";

/** "Schweiz (CH)", or the code alone where the language has no name for it. */
const countryName = (id: string | undefined, lang: string) =>
  id ? `${new Intl.DisplayNames([lang], { type: "region" }).of(id) ?? id} (${id})` : undefined;

async function render(node: Node) {
  const { app } = node;
  const t = app.t;
  const ctx = getCtx();
  const source = String(await app.settings["locale.geoip"].source ?? "dbip");
  const options = NAMES.map((v) => html`<option value=${v} ${v === source ? html.raw("selected") : ""}>${LABELS[v] ?? v}`);
  const fetched = await geoip.fetched(app);
  const ip = ctx.req.clientIp;
  const own = countryName(await geoip.country(app, ip), ctx.lang);
  const size = await geoip.size(app);
  const count = (n: number) => `${Math.round(n / 1000)}k`;

  return html.async`<div class=u2-card style="flex:0 1 auto">
  <div class=-head>
    ${t`IP to country`}
  </div>
  <div>
    <label>
      ${t`Source`}
      <select class=-source>${options}</select>
    </label>
    <table class=u2-table>
      <thead>
        <tr>
          <th>
          <th> DB-IP Lite
          <th> ${t`Registries`}
      <tbody>
        <tr>
          <th> ${t`Accuracy`}
          <td> ${t`where addresses are used`}
          <td> ${t`where blocks were handed out; less exact for blocks used in several countries`}
        <tr>
          <th> ${t`Memory`}
          <td> ~6 MB
          <td> ~3 MB
        <tr>
          <th> ${t`Download`}
          <td> ~5 MB, ${t`published monthly`}
          <td> ~45 MB, ${t`published daily`}
        <tr>
          <th> ${t`Licence`}
          <td> CC BY 4.0: ${t`pages using the result should credit`} <a href="https://db-ip.com" target=_blank>db-ip.com</a>
          <td> ${t`public, no credit needed`}
    </table>
    <p>
      <small>${t`Held in memory, so a lookup takes microseconds and never touches the disk. Building the table (at start and after an update) takes up to ~80 MB more for about half a minute.`}</small>
    </p>
    <p>
      <button class=-now>${t`Update now`}</button>
      <small>${fetched ? html.async`${t`last`} ${showTime(fetched)}` : t`never fetched`}</small>
    </p>
    <p>
      ${size ? html.async`${t`Loaded`}: ${count(size.v4)} IPv4, ${count(size.v6)} IPv6 ${t`ranges`}` : t`Loading…`}
    </p>
    <p>
      ${t`Your address`}: ${ip} → ${own ?? t`unknown`}
    </p>
    <form class=-test>
      <input name=ip placeholder="${t`Test an address`}" required>
      <button>${t`Look up`}</button>
      <output></output>
    </form>
  </div>
</div>`;
}

export async function backendDashboardWidget(app: App): Promise<HtmlString> {
  const source = String(await app.settings["locale.geoip"].source ?? "dbip");
  const fetched = await geoip.fetched(app);
  return html.async`<div>
  ${LABELS[source] ?? source}<br>
  <small>${fetched ? showTime(fetched) : app.t`never fetched`}</small>
</div>`;
}

export const cms = { node: { render, api, js: ["pub/main.js"] } };
