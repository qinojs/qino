// deno-lint-ignore-file no-explicit-any
import { html } from "@qino/qino";

import { CATALOG } from "./catalog.ts";

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

// What a request may need besides its capability; ai1 derives these from the input.
const NEEDS = ["vision", "tools"];

const adapters = (app: App): Record<string, object> => Object.assign({}, ...app.modules.linked().map((mod) => mod.plugin.ai1Adapters));

/** The matrix columns: what adapters serve and tasks define, the needs, and whatever is in use. */
export async function capabilities(app: App): Promise<string[]> {
  const tasks = app.modules.linked().flatMap((mod) => Object.entries<any>(mod.plugin.ai1Tasks ?? {}));
  return [...new Set([
    ...Object.values(adapters(app)).flatMap(Object.keys),
    ...tasks.flatMap(([capability, task]) => [capability, ...Object.keys(task.via ?? {})]),
    ...NEEDS,
    ...(await app.db.col`SELECT DISTINCT capability FROM ai1_model_capability`).map(String),
  ])];
}

const number = (value: unknown) => Number(value ?? 0).toLocaleString("en-US");
const checkbox = (on: unknown) => html`<input type=checkbox name=enabled ${on ? "checked" : ""}>`;
const options = (list: { value: unknown; label: unknown }[], selected: unknown) =>
  list.map((o) => html`<option value="${o.value}" ${String(o.value) === String(selected) ? "selected" : ""}>${o.label}`);

export function render(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  return html.async`<div class=u2-flex>
  <div class="u2-card -models">
    <div class=-head>${t`Models`}</div>
    <div cms-part=models>${models(node)}</div>
  </div>
  <div class="u2-card -providers">
    <div class=-head>${t`Providers`}</div>
    <div cms-part=providers>${providers(node)}</div>
  </div>
  <div class="u2-card -try">
    <div class=-head>${t`Try`}</div>
    <form class="u2-flex -Col">
      <textarea name=prompt rows=3 required placeholder="${t`Ask something`}"></textarea>
      <div class=u2-flex>
        <select name=model><option value="">${t`any model`}${modelOptions(node.app)}</select>
        <select name=prefer><option value=cost>${t`cheapest first`}<option value=speed>${t`fastest first`}</select>
        <button>${t`Send`}</button>
      </div>
      <output></output>
    </form>
  </div>
</div>`;
}

async function modelOptions(app: App): Promise<HtmlString[]> {
  const rows = await app.db.query`SELECT name FROM ai1_model WHERE enabled = ${true} ORDER BY name`;
  return options(rows.map((r) => ({ value: r.name, label: r.name })), "");
}

/** Models × capabilities: a cell holds the priority, empty means the model can't. Each model
 *  unfolds into the providers it runs at. */
export async function models(node: Node): Promise<HtmlString> {
  const app = node.app, t = app.t, db = app.db;
  const [caps, rows, priorities, offers, providers] = await Promise.all([
    capabilities(app),
    db.query`SELECT * FROM ai1_model ORDER BY name`,
    db.query`SELECT * FROM ai1_model_capability`,
    db.query`SELECT * FROM ai1_model_provider ORDER BY id`,
    db.query`SELECT id, name, type, enabled FROM ai1_provider ORDER BY name`,
  ]);
  const providerList = providers.map((p) => ({ value: p.id, label: p.name }));
  const span = caps.length + 3;

  const listing = new Set(providers.filter((p) => p.type === "openai").map((p) => p.id)); // those with /models
  const offerRow = (o: any) => html`<tr data-row=ai1_model_provider data-id="${o.id}">
      <td><select name=provider_id>${options(providerList, o.provider_id)}</select>
      <td><input name=provider_model value="${o.provider_model ?? ""}" ${listing.has(o.provider_id) ? html`list="ai1-offered-${o.provider_id}" data-provider="${o.provider_id}"` : ""}>
      <td><input name=cost type=number step=any min=0 value="${o.cost ?? ""}">
      <td><input name=speed type=number step=any min=0 value="${o.speed ?? ""}">
      <td>${number(o.used_input)} / ${number(o.used_output)}
      <td>${checkbox(o.enabled)}
      <td><button type=button class=u2-unstyle data-remove title=remove><u2-ico icon=delete>✕</u2-ico></button>`;

  const modelRows = rows.map((model) => {
    const own = offers.filter((o) => o.model_id === model.id);
    const usable = own.some((o) => o.enabled && providers.find((p) => p.id === o.provider_id)?.enabled);
    const cells = caps.map((capability) => {
      const priority = priorities.find((p) => p.model_id === model.id && p.capability === capability)?.priority;
      return NEEDS.includes(capability)
        ? html`<td><input type=checkbox data-capability="${capability}" ${priority == null ? "" : "checked"}>`
        : html`<td><input type=number step=1 data-capability="${capability}" value="${priority ?? ""}" placeholder=–>`;
    });
    return html.async`<tbody data-row=ai1_model data-id="${model.id}">
    <tr>
      <th><input name=name value="${model.name}" required>
      ${cells}
      <td>${checkbox(model.enabled)}
      <td><button type=button class=u2-unstyle data-remove u2-confirm="${t`Remove this model?`}" title=remove><u2-ico icon=delete>✕</u2-ico></button>
    <tr><td colspan=${span}>
      <details>
        <summary>${own.length} ${t`providers`}${usable ? "" : html.async` <small class=u2-badge style="--color-dark:var(--red)">${t`unusable`}</small>`}</summary>
        <table class=u2-table>
          <thead><tr>
            <th>${t`Provider`}
            <th>${t`Name there`}
            <th>${t`Cost`} <small>/M</small>
            <th>${t`Speed`} <small>/s</small>
            <th>${t`Used in / out`}
            <th>${t`On`}
            <th>
          <tbody>${own.map(offerRow)}
          <tr><td colspan=7>
            <form class=u2-flex data-add=offer>
              <select name=provider_id required>${options(providerList, "")}</select>
              <button>${t`Add provider`}</button>
            </form>
        </table>
      </details>
    </tbody>`;
  });

  return html.async`<table class="u2-table -Sticky">
  <thead><tr>
    <th>${t`Model`}
    ${caps.map((capability) => html`<th class=-capability>${capability}`)}
    <th>${t`On`}
    <th>
  ${modelRows}
  <tbody><tr><td colspan=${span}>
    <form class=u2-flex data-add=model>
      <input name=name required placeholder="${t`model, e.g. llama-3.3-70b`}">
      <button>${t`Add model`}</button>
    </form>
</table>
${[...listing].map((id) => html`<datalist id="ai1-offered-${id}"></datalist>`)}`;
}

export async function providers(node: Node): Promise<HtmlString> {
  const app = node.app, t = app.t;
  const rows = await app.db.query`
    SELECT p.*, COUNT(mp.id) AS models, COALESCE(SUM(mp.used_input), 0) AS used_input, COALESCE(SUM(mp.used_output), 0) AS used_output
    FROM ai1_provider p LEFT JOIN ai1_model_provider mp ON mp.provider_id = p.id
    GROUP BY p.id, p.name, p.type, p.endpoint, p.timeout_ms, p.enabled ORDER BY p.name`;
  const types = Object.keys(adapters(app)).map((type) => ({ value: type, label: type }));

  const providerRows = await Promise.all(rows.map(async (p) => {
    const key = String(await app.settings.core.keys[p.name] ?? "");
    const keyUrl = CATALOG.find((c) => c.name === p.name)?.console;
    return html.async`<tr data-row=ai1_provider data-id="${p.id}" data-name="${p.name}">
      <th>${p.name}
      <td><select name=type>${options(types, p.type)}</select>
      <td><input name=endpoint value="${p.endpoint}" required>
      <td><input name=timeout_ms type=number min=1000 step=1000 value="${p.timeout_ms}">
      <td>
        <small class=u2-badge style="--color-dark:var(${key ? "--green" : "--gray"})">${key ? `…${key.slice(-4)}` : t`no key`}</small>
        <button type=button class=u2-unstyle data-key title="${t`Set key`}"><u2-ico icon=key>⚿</u2-ico></button>
        ${keyUrl ? html.async`<a href="${keyUrl}" target=_blank rel=noopener title="${t`Get a key`}"><u2-ico icon=open_in_new>↗</u2-ico></a>` : ""}
      <td>${p.models}
      <td>${number(p.used_input)} / ${number(p.used_output)}
      <td>${checkbox(p.enabled)}
      <td>
        ${p.type === "openai" ? html.async`<button type=button class=u2-unstyle data-offered title="${t`Its models`}"><u2-ico icon=list>☰</u2-ico></button>` : ""}
        <button type=button class=u2-unstyle data-remove u2-confirm="${t`Remove this provider and its models there?`}" title=remove><u2-ico icon=delete>✕</u2-ico></button>`;
  }));

  return html.async`<table class="u2-table -Sticky">
  <thead><tr>
    <th>${t`Name`}
    <th>${t`Type`}
    <th>${t`Endpoint`}
    <th>${t`Timeout`} <small>ms</small>
    <th>${t`Key`}
    <th>${t`Models`}
    <th>${t`Used in / out`}
    <th>${t`On`}
    <th>
  <tbody>${providerRows}
  <tr><td colspan=9>
    <form class=u2-flex data-add=provider data-catalog="${JSON.stringify(CATALOG)}">
      <input name=name required list=ai1-catalog placeholder="${t`name, e.g. api.openai.com`}">
      <select name=type>${options(types, "openai")}</select>
      <input name=endpoint required placeholder="https://…/v1">
      <button>${t`Add provider`}</button>
    </form>
</table>
<datalist id=ai1-catalog>${CATALOG.map((c) => html`<option value="${c.name}">`)}</datalist>`;
}

/** Dashboard: models in use, providers without key. */
export async function widget(app: App): Promise<HtmlString> {
  const t = app.t;
  const models = Number(await app.db.one`SELECT COUNT(*) FROM ai1_model WHERE enabled = ${true}`);
  const names = (await app.db.col`SELECT name FROM ai1_provider WHERE enabled = ${true}`).map(String);
  const keyless = [];
  for (const name of names) if (!await app.settings.core.keys[name]) keyless.push(name);
  return html.async`<div class=-body>
    <b>${models}</b> ${t`models`} · <b>${names.length}</b> ${t`providers`}
    ${keyless.length ? html.async` · <span class=u2-badge style="background:var(--red)">${keyless.length} ${t`without key`}</span>` : ""}
  </div>`;
}
