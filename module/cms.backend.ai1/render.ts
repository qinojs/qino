// deno-lint-ignore-file no-explicit-any
import { getCtx, html, sql, sqlSearch } from "@qino/qino";
import * as u2 from "@qino/qino/u2";

import { CATALOG } from "./catalog.ts";
import { adapters, BENCHMARKS_KEY, listing, SPEED } from "./lib/sources.ts";

import type { App, Ctx, HtmlString, Sql } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

// What a request may need besides its capability; ai1 derives these from the input.
const NEEDS = ["vision", "tools"];
/** More models than this: narrow the filter. */
const LIMIT = 200;
const INTELLIGENCE = "intelligence";
/** What Try offers; the fields each asks for carry `data-for`. */
const ACTIONS = ["text", "structured", "translate", "decide", "embed", "image", "speak", "transcribe"];
const SCHEMA = '{"type":"object","properties":{"answer":{"type":"string"}},"required":["answer"]}';

type Vars = Record<string, any>;

/** The capability columns: what adapters serve and capabilities define, the needs, and whatever is in use. */
export async function capabilities(app: App): Promise<string[]> {
  const defs = app.modules.linked().flatMap((mod) => Object.entries<any>(mod.plugin.ai1Capabilities ?? {}));
  return [...new Set([
    ...Object.values(adapters(app)).flatMap(Object.keys),
    ...defs.flatMap(([capability, def]) => [capability, ...Object.keys(def.via ?? {})]),
    ...NEEDS,
    ...(await app.db.col`SELECT DISTINCT capability FROM ai1_model_capability`).map(String),
  ])];
}

const value = (v: unknown, digits = 1) => v == null ? "–" : Number(v).toLocaleString("en-US", { maximumFractionDigits: digits });
const label = (metric: string) => metric.replaceAll("_", " ");
const checkbox = (on: unknown) => html`<input type=checkbox name=enabled ${on ? "checked" : ""}>`;
const options = (list: { value: unknown; label: unknown }[], selected: unknown) =>
  list.map((o) => html`<option value="${o.value}" ${String(o.value) === String(selected) ? "selected" : ""}>${o.label}`);
const remove = (confirm?: unknown) =>
  html.async`<button type=button class=u2-unstyle data-remove ${confirm ? html.async`u2-confirm="${confirm}"` : ""} title=remove><u2-ico icon=delete>✕</u2-ico></button>`;

/** Two views on one page: `?show=models` (default) and `?show=providers`. */
export function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const app = node.app, t = app.t;
  const vars = ctx.req.query as Vars;
  const models = vars.show !== "providers";
  const link = (show: string) => {
    const url = ctx.req.url.toURL();
    for (const k of [...url.searchParams.keys()]) if (k !== "cmspid") url.searchParams.delete(k);
    url.searchParams.set("show", show);
    return url.pathname + url.search;
  };
  return html.async`<div class=u2-flex>
  <div class="u2-card -main">
    <div class=-head>
      <a href="${link("models")}" ${models ? "aria-current=page" : ""}>${t`Models`}</a>
      <a href="${link("providers")}" ${models ? "" : "aria-current=page"}>${t`Providers`}</a>
      <button type=button data-evaluate title="${t`Import all models, their data and benchmarks`}">${t`Import now`}</button>
      <button type=button data-benchmark-key>${t`Benchmark key`}</button>
    </div>
    ${models ? filters(app, vars) : ""}
    <div cms-part=view>${view(node, { vars })}</div>
    <div class=-body><small>
      ${t`Models, context, prices, capabilities`}: ${t`the providers and`} <a href="https://models.dev" target=_blank rel=noopener>models.dev</a>
      · ${t`Benchmarks`}: <a href="https://artificialanalysis.ai/" target=_blank rel=noopener>Artificial Analysis</a>
      · ${t`Speed and errors: measured on the calls. Imports daily.`}
    </small></div>
  </div>
  ${models ? tryCard(app) : ""}
</div>`;
}

/** The part: the models or the providers. */
export function view(node: Node, { vars = {} }: { vars?: Vars } = {}): Promise<HtmlString> {
  return vars.show === "providers" ? providers(node) : modelList(node, vars);
}

async function filters(app: App, vars: Vars): Promise<HtmlString> {
  const t = app.t;
  const [providerList, caps, metrics] = await Promise.all([
    app.db.query`SELECT id, name FROM ai1_provider ORDER BY name`,
    capabilities(app),
    app.db.col`SELECT DISTINCT metric FROM ai1_model_score`,
  ]);
  const sorts = [
    { value: "", label: await t`intelligence` },
    { value: "name", label: await t`name` },
    { value: "cost", label: await t`cheapest` },
    { value: "speed", label: await t`fastest` },
    { value: "context_length", label: await t`longest context` },
    ...metrics.map(String).filter((m) => m !== INTELLIGENCE && m !== SPEED).map((m) => ({ value: m, label: label(m) })),
  ];
  return html.async`<form class="u2-flex -filter" data-filter>
    <input type=search name=q value="${vars.q ?? ""}" placeholder="${t`Search models`}">
    <select name=provider><option value="">${t`all providers`}${options(providerList.map((p) => ({ value: p.id, label: p.name })), vars.provider)}</select>
    <select name=capability><option value="">${t`all capabilities`}${options(caps.map((c) => ({ value: c, label: c })), vars.capability)}</select>
    <select name=sort title="${t`Order`}">${options(sorts, vars.sort ?? "")}</select>
    <label><input type=checkbox name=all value=1 ${vars.all ? "checked" : ""}> ${t`also switched off`}</label>
    <button type=button data-switch=on u2-confirm="${t`Switch on every model the search, provider and capability match?`}">${t`all on`}</button>
    <button type=button data-switch=off u2-confirm="${t`Switch off every model the search, provider and capability match?`}">${t`all off`}</button>
  </form>`;
}

/** The filter's conditions on `ai1_model m`, apart from on/off. */
export function matching(vars: Vars): Sql[] {
  return [
    vars.q ? sqlSearch(String(vars.q), ["m.name"]).where : null,
    vars.provider ? sql`EXISTS (SELECT 1 FROM ai1_model_provider f WHERE f.model_id = m.id AND f.provider_id = ${Number(vars.provider)})` : null,
    vars.capability ? sql`EXISTS (SELECT 1 FROM ai1_model_capability f WHERE f.model_id = m.id AND f.capability = ${String(vars.capability)})` : null,
  ].filter((w) => w !== null);
}

/** Models × capabilities (what each can do), their scores, the best price and speed; each model's
 *  providers and all its scores open in a dialog (pub/main.js), from its template. */
async function modelList(node: Node, vars: Vars): Promise<HtmlString> {
  const app = node.app, t = app.t, db = app.db;
  const where = [...matching(vars), ...vars.all ? [] : [sql`m.enabled = ${true}`]];
  const [caps, rows, scores, abilities, offers, stats, providerRows] = await Promise.all([
    capabilities(app),
    db.query`SELECT * FROM ai1_model m ${where.length ? sql`WHERE ${sql.join(where, " AND ")}` : sql``}`,
    db.query`SELECT model_id, metric, value FROM ai1_model_score`,
    db.query`SELECT * FROM ai1_model_capability`,
    db.query`SELECT * FROM ai1_model_provider ORDER BY id`,
    db.query`SELECT * FROM ai1_model_provider_stat`,
    db.query`SELECT id, name, enabled FROM ai1_provider ORDER BY name`,
  ]);
  const score = new Map(scores.map((s) => [`${s.model_id} ${s.metric}`, Number(s.value)]));
  const has = new Set(abilities.map((a) => `${a.model_id} ${a.capability}`));
  const own = (model: number) => offers.filter((o) => o.model_id === model);
  const on = (o: any) => o.enabled && providerRows.find((p) => p.id === o.provider_id)?.enabled;
  const best = (model: number, column: "cost" | "speed") => {
    const values = own(model).filter((o) => on(o) && o[column] != null).map((o) => Number(o[column]));
    return values.length ? (column === "cost" ? Math.min : Math.max)(...values) : undefined;
  };

  // by a score (default intelligence), or name, price, speed, context length; unknown last
  const sort = String(vars.sort || INTELLIGENCE);
  const sortValue = (m: any) => sort === "context_length" ? m.context_length
    : sort === "cost" || sort === "speed" ? best(m.id, sort) : score.get(`${m.id} ${sort}`);
  const byName = (a: any, b: any) => String(a.name).localeCompare(String(b.name));
  rows.sort(sort === "name" ? byName : (a, b) => {
    const x = sortValue(a), y = sortValue(b);
    return Number(x == null) - Number(y == null) || (sort === "cost" ? x - y : y - x) || byName(a, b);
  });
  const shown = rows.slice(0, LIMIT);
  const indexes = [...new Set(scores.map((s) => String(s.metric)).filter((m) => m !== SPEED))]
    .sort((a, b) => Number(b === INTELLIGENCE) - Number(a === INTELLIGENCE) || a.localeCompare(b));
  const providerList = providerRows.map((p) => ({ value: p.id, label: p.name }));
  const span = 7 + caps.length + indexes.length;

  const offerRow = (o: any) => {
    const s = stats.find((x) => x.model_provider_id === o.id);
    return html.async`<tr data-row=ai1_model_provider data-id="${o.id}">
      <td>${checkbox(o.enabled)}
      <td><select name=provider_id>${options(providerList, o.provider_id)}</select>
      <td><input name=provider_model value="${o.provider_model ?? ""}" placeholder="${t`same name`}">
      <td class=-num><input name=cost type=number step=any min=0 value="${o.cost ?? ""}">
      <td class=-num><input name=speed type=number step=any min=0 value="${o.speed ?? ""}">
      <td class=-num>${value(s?.calls, 0)}
      <td class=-num>${s?.calls ? `${value(100 * s.errors / s.calls, 0)} %` : "–"}
      <td class=-num>${s?.ms ? value(s.output / (s.ms / 1000)) : "–"}
      <td>${s?.last_error ? html`<details><summary>${u2.el.time(s.last_at)}</summary><div class=-error>${s.last_error}</div></details>` : ""}
      <td>${remove()}`;
  };

  const modelRows = shown.map((model) => {
    const offersOf = own(model.id);
    const cells = caps.map((capability) =>
      html`<td><input type=checkbox data-capability="${capability}" ${has.has(`${model.id} ${capability}`) ? "checked" : ""}>`);
    const all = scores.filter((s) => s.model_id === model.id);
    return html.async`<tr data-row=ai1_model data-id="${model.id}" data-name="${model.name}" ${model.enabled ? "" : "data-off"}>
      <td>${checkbox(model.enabled)}
      <th><input name=name value="${model.name}" required>
      <td class=-num><input name=context_length type=number min=0 step=1024 value="${model.context_length ?? ""}" placeholder=–>
      ${cells}
      ${indexes.map((metric) => html`<td class=-num>${value(score.get(`${model.id} ${metric}`))}`)}
      <td class=-num>
        ${offersOf.some(on) ? "" : html.async`<small class=u2-badge style="--color-dark:var(--red)">${t`unusable`}</small>`}
        <button type=button class=u2-unstyle data-offers title="${t`Its providers`}">${offersOf.length}</button>
        <template>
          <table class=u2-table>
            <thead><tr>
              <th>${t`On`}
              <th>${t`Provider`}
              <th>${t`Name there`}
              <th class=-num>${t`Cost`} <small>/M</small>
              <th class=-num>${t`Speed`} <small>/s</small>
              <th class=-num>${t`Calls`}
              <th class=-num>${t`Errors`}
              <th class=-num>${t`Measured t/s`}
              <th>${t`Last error`}
              <th>
            <tbody>${offersOf.map(offerRow)}
          </table>
          <div class=u2-flex>
            <select data-provider>${options(providerList, "")}</select>
            <button type=button data-add=offer data-model="${model.id}">${t`Add provider`}</button>
          </div>
          ${all.length ? html`<p>${all.map((s) => html`<span title="${s.metric}">${label(String(s.metric))} <b>${value(s.value, 3)}</b></span> `)}</p>` : ""}
        </template>
      <td class=-num>${value(best(model.id, "cost"), 3)}
      <td class=-num>${value(best(model.id, "speed"))}
      <td>${remove(t`Remove this model?`)}`;
  });

  return html.async`<table class="u2-table -Sticky">
  <thead><tr>
    <th>${t`On`}
    <th>${t`Model`}
    <th class=-v title="${t`Context length in tokens; a longer request skips the model`}">${t`Context`}
    ${caps.map((capability) => html`<th class=-v>${capability}`)}
    ${indexes.map((metric) => html`<th class=-v title="${metric}">${label(metric)}${caps.includes(metric) ? " quality" : ""}`)}
    <th class=-num>${t`Providers`}
    <th class=-num>${t`Cost`} <small>/M</small>
    <th class=-num>${t`Speed`} <small>/s</small>
    <th>
  <tbody>${modelRows}
  <tr><td colspan=${span}>
    ${rows.length > LIMIT ? html.async`<p>${rows.length - LIMIT} ${t`more — narrow the filter.`}</p>` : ""}
    <form class=u2-flex data-add=model>
      <input name=name required placeholder="${t`model, e.g. llama-3.3-70b`}">
      <button>${t`Add model`}</button>
    </form>
</table>`;
}

async function providers(node: Node): Promise<HtmlString> {
  const app = node.app, t = app.t;
  const rows = await app.db.query`
    SELECT p.*, COUNT(mp.id) AS models, SUM(CASE WHEN m.enabled = ${true} AND mp.enabled = ${true} THEN 1 ELSE 0 END) AS active,
      COALESCE(SUM(s.used_input), 0) AS used_input, COALESCE(SUM(s.used_output), 0) AS used_output
    FROM ai1_provider p LEFT JOIN ai1_model_provider mp ON mp.provider_id = p.id LEFT JOIN ai1_model m ON m.id = mp.model_id
      LEFT JOIN ai1_model_provider_stat s ON s.model_provider_id = mp.id
    GROUP BY p.id, p.name, p.type, p.endpoint, p.timeout_ms, p.enabled ORDER BY p.name`;
  const types = Object.keys(adapters(app)).map((type) => ({ value: type, label: type }));

  const providerRows = await Promise.all(rows.map(async (p) => {
    const key = String(await app.settings.core.keys[p.name] ?? "");
    const keyUrl = CATALOG.find((c) => c.name === p.name)?.console;
    const url = getCtx().req.url.toURL(); // its models, switched off too
    for (const [k, v] of Object.entries({ show: "models", all: "1", provider: String(p.id) })) url.searchParams.set(k, v);
    const models = url.pathname + url.search;
    return html.async`<tr data-row=ai1_provider data-id="${p.id}" data-name="${p.name}">
      <td>${checkbox(p.enabled)}
      <th><a href="${models}">${p.name}</a>
      <td class=-num><a href="${models}" title="${t`active / all`}">${p.active ?? 0} / ${p.models}</a>
      <td><select name=type>${options(types, p.type)}</select>
      <td><input name=endpoint value="${p.endpoint}" required>
      <td class=-num><input name=timeout_ms type=number min=1000 step=1000 value="${p.timeout_ms}">
      <td>
        <small class=u2-badge style="--color-dark:var(${key ? "--green" : "--gray"})">${key ? `…${key.slice(-4)}` : t`no key`}</small>
        <button type=button class=u2-unstyle data-key title="${t`Set key`}"><u2-ico icon=key>⚿</u2-ico></button>
        ${keyUrl ? html.async`<a href="${keyUrl}" target=_blank rel=noopener title="${t`Get a key`}"><u2-ico icon=open_in_new>↗</u2-ico></a>` : ""}
      <td class=-num>${value(p.used_input, 0)} / ${value(p.used_output, 0)}
      <td>${listing(app, p.type) ? "" : html.async`<small title="${t`Lists no models; add them by hand`}">${t`by hand`}</small>`}
      <td>${remove(t`Remove this provider and its models there?`)}`;
  }));

  return html.async`<table class="u2-table -Sticky">
  <thead><tr>
    <th>${t`On`}
    <th>${t`Name`}
    <th class=-num>${t`Models`}
    <th>${t`Type`}
    <th>${t`Endpoint`}
    <th class=-num>${t`Timeout`} <small>ms</small>
    <th>${t`Key`}
    <th class=-num>${t`Used in / out`}
    <th>
    <th>
  <tbody>${providerRows}
  <tr><td colspan=10>
    <form class=u2-flex data-add=provider data-catalog="${JSON.stringify(CATALOG)}">
      <input name=name required list=ai1-catalog placeholder="${t`name, e.g. api.openai.com`}">
      <select name=type>${options(types, "openai")}</select>
      <input name=endpoint required placeholder="https://…/v1">
      <button>${t`Add provider`}</button>
    </form>
</table>
<datalist id=ai1-catalog>${CATALOG.map((c) => html`<option value="${c.name}">`)}</datalist>`;
}

/** One call of a capability through ai1's own choice: who would answer (for the weights), then who did. */
async function tryCard(app: App): Promise<HtmlString> {
  const t = app.t;
  const [names, metrics] = await Promise.all([
    app.db.col`SELECT name FROM ai1_model WHERE enabled = ${true} ORDER BY name`,
    app.db.col`SELECT DISTINCT metric FROM ai1_model_score WHERE metric <> ${SPEED} ORDER BY metric`,
  ]);
  const criteria = [...new Set(["cost", "speed", INTELLIGENCE, ...metrics.map(String)])];
  return html.async`<div class="u2-card -try">
    <div class=-head>${t`Try`}</div>
    <form class="u2-flex -Col">
      <select name=capability>${options(ACTIONS.map((a) => ({ value: a, label: a })), "text")}</select>
      <textarea name=prompt rows=3 data-for="text structured translate decide embed image speak" placeholder="${t`Input — for embed one text per line`}"></textarea>
      <textarea name=schema rows=3 data-for=structured hidden title="JSON Schema">${SCHEMA}</textarea>
      <div class=u2-flex data-for=translate hidden>
        <input name=to value=en placeholder="${t`to, e.g. en`}">
        <input name=from placeholder="${t`from (optional)`}">
      </div>
      <div class=u2-flex data-for=decide hidden>
        <input name=question placeholder="${t`question (optional)`}">
        <input name=options value="yes, no" placeholder="${t`options, comma separated`}">
      </div>
      <input name=voice data-for=speak hidden placeholder="${t`voice, e.g. alloy`}">
      <input type=file name=file accept="audio/*,video/*" data-for=transcribe hidden>
      <div class=u2-flex>
        <select name=model><option value="">${t`any model`}${options(names.map((n) => ({ value: n, label: n })), "")}</select>
        <button>${t`Send`}</button>
      </div>
      <table class=-weights>${criteria.map((c) => html`<tr>
        <th>${label(c)}
        <td><input type=range min=0 max=10 step=1 data-weight="${c}" value=0>
        <td class=-num><output>0</output>`)}
      </table>
      <small>${t`All at 0: ai1's own choice — the capability's own score or intelligence, then cheap and fast.`}</small>
      <ol class=-candidates></ol>
      <output></output>
    </form>
  </div>`;
}

/** Dashboard: active models, providers, those without key, whether benchmarks come in. */
export async function widget(app: App): Promise<HtmlString> {
  const t = app.t;
  const models = Number(await app.db.one`SELECT COUNT(*) FROM ai1_model WHERE enabled = ${true}`);
  const names = (await app.db.col`SELECT name FROM ai1_provider WHERE enabled = ${true}`).map(String);
  const keyless = [];
  for (const name of names) if (!await app.settings.core.keys[name]) keyless.push(name);
  const benchmarks = !!await app.settings.core.keys[BENCHMARKS_KEY];
  return html.async`<div class=-body>
    <b>${models}</b> ${t`active models`} · <b>${names.length}</b> ${t`providers`}
    ${keyless.length ? html.async` · <span class=u2-badge style="background:var(--red)">${keyless.length} ${t`without key`}</span>` : ""}
    ${benchmarks ? "" : html.async` · <span class=u2-badge>${t`no benchmark key`}</span>`}
  </div>`;
}
