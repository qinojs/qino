// deno-lint-ignore-file no-explicit-any

import { errMsg, html, type App, type Ctx, type HtmlString } from "../core/mod.ts";
import { KINDS, providerCatalog } from "../ai/mod.ts";
import { backend } from "../cms.backend/mod.ts";
import type { Node } from "../cms/mod.ts";

export const name = "cms.backend.ai";
export const description = "Configures AI providers, models, defaults, and token usage.";
export const needs = ["cms.backend", "ai"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, "cms.backend.ai", { en: "AI", de: "KI" });
}

type Message = { type: "ok" | "error"; text: string };
type Row = Record<string, any>;

// Derive a provider name from its endpoint host (drop a leading "api."). Must match
// the same rule in pub/main.js so the new provider can be auto-opened after adding.
function nameFromEndpoint(endpoint: string): string {
  try { return new URL(endpoint).host.replace(/^api\./, ""); }
  catch { return endpoint.replace(/^https?:\/\//, "").split("/")[0]; }
}

// /models exposes no modality, so infer the kind from the model id (correctable in the UI).
function guessKind(id: string): string {
  const s = id.toLowerCase();
  if (/embed|rerank|colbert/.test(s)) return "embedding";
  if (/image|dall|imagine|flux|stable.?diffusion|sdxl/.test(s)) return "image";
  return "chat";
}

// u2-badge; `color` is a CSS var name (e.g. "--green") to tint it.
function badge(text: string, color = "", cls = ""): HtmlString {
  return html`<small class="u2-badge${cls ? ` ${cls}` : ""}"${color ? html.raw(` style="--color-dark:var(${color})"`) : ""}>${text}</small>`;
}

// Kind <option>s with an empty (unassigned) first entry.
function kindOptions(selected = ""): HtmlString {
  return html`<option value=""${selected ? "" : " selected"}>${
    html.join(KINDS.map((k) => html`<option value="${k}"${k === selected ? " selected" : ""}>${k}`))}`;
}

// Kind <option>s for the model filter, with an "all kinds" first entry.
function filterKindOptions(selected = ""): HtmlString {
  return html`<option value=""${selected ? "" : " selected"}>all kinds${
    html.join(KINDS.map((k) => html`<option value="${k}"${k === selected ? " selected" : ""}>${k}`))}`;
}

// Insert a catalog model, becoming the kind's default only if none exists yet.
async function insertModel(app: App, providerId: number, m: { model_id: string; kind: string; is_default?: boolean }): Promise<void> {
  const hasDefault = m.is_default && await app.db.one`SELECT id FROM ai_provider_model WHERE kind = ${m.kind} AND is_default = ${true}`;
  await app.db.table("ai_provider_model").insert({
    provider_id: providerId, model_id: m.model_id, kind: m.kind,
    is_default: m.is_default && !hasDefault ? 1 : 0,
    used_input_tokens: 0, used_output_tokens: 0,
  });
}

// --- Actions -------------------------------------------------------------
// Called from render() with the JS-posted vars (api html.post). Access is gated
// by the backend node itself; no CSRF token needed — api carries credentials.

async function handleAction(app: App, vars: Record<string, any>): Promise<Message | null> {
  if (!("action" in vars)) return null;
  const action = String(vars.action ?? "");

  if (action === "add-provider") {
    const endpoint = String(vars.endpoint ?? "").trim();
    if (!endpoint) return { type: "error", text: "Endpoint required." };
    const provName = nameFromEndpoint(endpoint);
    if (await app.db.one`SELECT id FROM ai_provider WHERE name = ${provName}`) return { type: "error", text: `Provider "${provName}" already exists.` };
    const entry = providerCatalog.find((c) => c.endpoint === endpoint); // known endpoint → seed its models + default
    const id = Number(await app.db.table("ai_provider").insert({ name: provName, endpoint, timeout_ms: entry?.timeout_ms ?? 60000 }));
    for (const m of entry?.models ?? []) await insertModel(app, id, m);
    return { type: "ok", text: `Provider ${provName} added.` };
  }

  if (action === "save-default") {
    const kind = String(vars.kind ?? "");
    const modelId = Number(vars.model_id);
    if (!modelId) return { type: "error", text: "No model selected." };
    await app.db.exec`UPDATE ai_provider_model SET is_default = ${false} WHERE kind = ${kind}`;
    if (await app.db.one`SELECT id FROM ai_provider_model WHERE id = ${modelId} AND kind = ${kind}`) {
      await app.db.table("ai_provider_model").update(modelId, { is_default: true });
    }
    return { type: "ok", text: `Default ${kind} model saved.` };
  }

  const providerId = Number(vars.provider_id);
  const provider = providerId ? await app.db.row`SELECT * FROM ai_provider WHERE id = ${providerId}` : undefined;
  if (!provider) return { type: "error", text: "Unknown provider." };

  if (action === "save-provider") {
    const key = String(vars.api_key ?? "").trim();
    if (key) await app.settings.ai.provider[provider.name].key(key);
    await app.db.table("ai_provider").update(providerId, { endpoint: String(vars.endpoint ?? provider.endpoint).trim() });
    return { type: "ok", text: `Provider ${provider.name} saved.` };
  }

  if (action === "delete-provider") {
    await app.db.table("ai_provider").delete(providerId); // ai_provider_model rows cascade
    await app.settings.ai.provider[provider.name].key(undefined); // clear the leftover api key
    return { type: "ok", text: `Provider ${provider.name} removed.` };
  }

  if (action === "sync-provider") return syncProviderModels(app, provider);

  if (action === "add-model") {
    const modelId = String(vars.model_id ?? "").trim();
    if (!modelId) return { type: "error", text: "Model ID missing." };
    if (await app.db.one`SELECT id FROM ai_provider_model WHERE provider_id = ${providerId} AND model_id = ${modelId}`) {
      return { type: "error", text: "Model already exists." };
    }
    await insertModel(app, providerId, { model_id: modelId, kind: String(vars.kind ?? "chat") });
    return { type: "ok", text: `Model ${modelId} added.` };
  }

  if (action === "set-kind") {
    const modelId = Number(vars.model_id ?? 0);
    if (await app.db.one`SELECT id FROM ai_provider_model WHERE id = ${modelId} AND provider_id = ${providerId}`) {
      await app.db.table("ai_provider_model").update(modelId, { kind: String(vars.kind ?? "chat") });
    }
    return { type: "ok", text: "Model kind updated." };
  }

  if (action === "delete-model") {
    await app.db.table("ai_provider_model").deleteWhere({ id: Number(vars.model_id ?? 0), provider_id: providerId });
    return { type: "ok", text: "Model deleted." };
  }

  return { type: "error", text: "Unknown action." };
}

async function syncProviderModels(app: App, provider: Row): Promise<Message> {
  const key = String(await app.settings.ai.provider[provider.name].key ?? "");
  let response: Response;
  try {
    response = await fetch(provider.endpoint + "/models", {
      headers: key ? { authorization: "Bearer " + key } : {},
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    return { type: "error", text: `Sync failed: ${errMsg(e)}` };
  }
  if (!response.ok) return { type: "error", text: `Sync failed: HTTP ${response.status}` };

  const result = await response.json().catch(() => null);
  const list = Array.isArray(result?.data) ? result.data : [];
  if (!list.length) return { type: "error", text: "Sync failed: no models in response." };

  const existing = new Set((await app.db.col`SELECT model_id FROM ai_provider_model WHERE provider_id = ${provider.id}`).map(String));
  let added = 0;
  for (const m of list) {
    const id = String((m as Row)?.id ?? "").trim();
    if (!id || existing.has(id)) continue;
    await insertModel(app, provider.id, { model_id: id, kind: guessKind(id) });
    added++;
  }
  return { type: "ok", text: `${added} new model(s) synchronised.` };
}

// --- Rendering -----------------------------------------------------------

// Provider box: settings + counts only — the models live in their own box.
function providerBox(provider: Row, modelCount: number, key: string, open: boolean): HtmlString {
  const pid = provider.id;
  return html`
<details${open ? " open" : ""}>
  <summary class=ai-provider-summary>
    ${provider.name}
    <span class=ai-summary-pills>
      ${badge(`${modelCount} Models`)}
      ${badge(key ? `Key ${key.slice(0, 12)}…` : "no key", key ? "--green" : "--red", key ? "ai-key-preview" : "")}
    </span>
  </summary>
  <div class=ai-provider-panel>
    <form class=ai-provider-form data-provider="${pid}">
      <table class=u2-table>
        <tr>
          <th>Endpoint
          <td><input name=endpoint value="${provider.endpoint}">
        <tr>
          <th>API-Key
          <td><input name=api_key type=text autocomplete=new-password data-lpignore=true data-form-type=other readonly onfocus="this.removeAttribute('readonly')" placeholder="API-Key (optional for local endpoints)">
      </table>
      <div class=ai-autosave-state aria-live=polite></div>
    </form>

    <div class=u2-flex>
      <button data-action=sync-provider data-provider="${pid}">sync from /models</button>
      <button data-action=delete-provider data-provider="${pid}" u2-confirm="Remove provider ${provider.name}?">remove provider</button>
    </div>
  </div>
</details>`;
}

function modelRow(model: Row): HtmlString {
  const pid = model.provider_id, mid = model.id;
  const usage = `${Number(model.used_input_tokens).toLocaleString("en-US")} / ${Number(model.used_output_tokens).toLocaleString("en-US")}`;
  const defaultCell = model.is_default
    ? html`<u2-ico icon=radio_button_checked title=default style="color:var(--cms-color,#16794d)">●</u2-ico>`
    : html`<button class=u2-unstyle data-action=save-default data-kind="${model.kind}" data-model="${mid}" title="set as default"><u2-ico icon=radio_button_unchecked>○</u2-ico></button>`;
  const kindCell = html`<select style="text-align:right" class=u2-unstyle data-action=set-kind data-provider="${pid}" data-model="${mid}">${kindOptions(model.kind)}</select>`;
  return html`<tr>
    <td><code>${model.model_id}</code>
    <td>${kindCell}
    <td style="text-align:center">${defaultCell}
    <td>${usage}
    <td><button class=u2-unstyle data-action=delete-model data-provider="${pid}" data-model="${mid}" u2-confirm="Delete model ${model.model_id}?" title=delete><u2-ico icon=delete>✕</u2-ico></button>`;
}

// Models grouped by provider with a sticky provider header. Filterable by kind / search.
async function models(node: Node, { vars = {} }: { vars?: Record<string, any> } = {}): Promise<HtmlString> {
  const app = node.app;
  const fkind = String(vars.filterKind ?? "");
  const fprovider = String(vars.filterProvider ?? "");
  const q = String(vars.filterSearch ?? "").trim().toLowerCase();
  const filtering = !!(fkind || q);

  const providers = await app.db.query`SELECT * FROM ai_provider ORDER BY name`;
  const allModels = await app.db.query`SELECT * FROM ai_provider_model ORDER BY model_id`;
  const byProvider = new Map<number, Row[]>();
  for (const m of allModels) (byProvider.get(m.provider_id) ?? byProvider.set(m.provider_id, []).get(m.provider_id)!).push(m);

  const tables = [];
  for (const provider of providers) {
    if (fprovider && String(provider.id) !== fprovider) continue;
    const rows = (byProvider.get(provider.id) ?? []).filter((m) =>
      (!fkind || m.kind === fkind) && (!q || String(m.model_id).toLowerCase().includes(q)));
    if (filtering && !rows.length) continue;

    const body = rows.length ? html.join(rows.map(modelRow)) : html`<tr><td colspan=5><em>No models yet.</em>`;
    // Without an active filter every group offers an add-model row (also for empty providers).
    const addRow = filtering ? "" : html`
      <tr><td colspan=5>
        <form class="ai-add-model u2-flex" data-provider="${provider.id}">
          <input required name=model_id placeholder="model id">
          <select name=kind>${kindOptions()}</select>
          <button>add model</button>
        </form>`;
    // Provider name + count double as the group header and the first column header (sticky).
    tables.push(html`
<table class="u2-table -Sticky">
  <thead><tr>
    <th>${provider.name} ${badge(`${(byProvider.get(provider.id) ?? []).length}`)}
    <th width=40 style="text-align:center">Kind
    <th width=20>Default
    <th width=50 title="Usage">in/out
    <th width=20>
  <tbody>${body}${addRow}
</table>`);
  }

  return tables.length ? html.join(tables) : html`<p><em>No models match the filter.</em></p>`;
}

// Current default model per kind — answers "where are the defaults?" at a glance.
function defaultsOverview(allModels: Row[], providersById: Map<number, Row>): HtmlString {
  const rows = KINDS.map((kind) => {
    const d = allModels.find((m) => m.kind === kind && m.is_default);
    const label = d ? `${providersById.get(d.provider_id)?.name} · ${d.model_id}` : "—";
    return html`<tr>
      <th>${kind}
      <td>${label}`;
  });
  return html`<table class=u2-table>${rows}</table>`;
}


async function render(node: Node, { ctx, vars = {} }: { ctx: Ctx; vars?: Record<string, any> }): Promise<HtmlString> {
  const app = node.app;
  const message = await handleAction(app, vars);

  const providers = await app.db.query`SELECT * FROM ai_provider ORDER BY name`;
  const allModels = await app.db.query`SELECT * FROM ai_provider_model ORDER BY kind, model_id`;
  const providersById = new Map(providers.map((p) => [p.id, p]));
  const countByProvider = new Map<number, number>();
  for (const m of allModels) countByProvider.set(m.provider_id, (countByProvider.get(m.provider_id) ?? 0) + 1);

  // Keep a provider expanded after acting on it: open name (add) or the acted provider_id.
  const openName = String(vars.open ?? ctx.req.query.open ?? "");
  const openId = Number(vars.provider_id);
  const providerBoxes = [];
  for (const provider of providers) {
    const key = String(await app.settings.ai.provider[provider.name].key ?? "");
    const isOpen = openName ? provider.name === openName : openId ? provider.id === openId : providers.length === 1;
    providerBoxes.push(providerBox(provider, countByProvider.get(provider.id) ?? 0, key, isOpen));
  }

  const fkind = String(vars.filterKind ?? "");
  const fprovider = String(vars.filterProvider ?? "");
  const fsearch = String(vars.filterSearch ?? "");
  const messageHtml = message ? html`<u2-alert open variant="${message.type === "ok" ? "success" : "error"}" style="flex-basis:100%">${message.text}</u2-alert>` : "";
  const emptyHint = providers.length ? "" : html`<p>No providers configured yet — add one below.</p>`;

  return html.async`
<div class=u2-flex>
  ${messageHtml}

  <div class=u2-card style="flex-grow:0">
    <div class=-head>Defaults</div>
    <div style="padding:0">${defaultsOverview(allModels, providersById)}</div>
  </div>

  <div class=u2-card style="min-width:40rem">
    <div class=-head>AI Provider</div>
    <div class="-body u2-flex -Col">
      ${emptyHint}
      ${providerBoxes}
      <form class="ai-add-provider u2-flex">
        <input required name=endpoint list=ai-provider-catalog placeholder="endpoint (OpenAI-compatible, e.g. https://api…/v1)">
        <datalist id=ai-provider-catalog>${providerCatalog.map((c) => html`<option value="${c.endpoint}">${c.name}`)}</datalist>
        <button>+ Add provider</button>
      </form>
    </div>
  </div>

  <div class=u2-card style="min-width:40rem">
    <div class=-head>Models</div>
    <div class=-body>
      <div class="u2-flex ai-model-filters">
        <select id=ai-filter-provider>
          <option value=""${fprovider ? "" : " selected"}>all providers
          ${providers.map((p) => html`<option value="${p.id}"${String(p.id) === fprovider ? " selected" : ""}>${p.name}`)}
        </select>
        <select id=ai-filter-kind>${filterKindOptions(fkind)}</select>
        <input id=ai-filter-search type=search placeholder="search models" value="${fsearch}">
      </div>
    </div>
    <div cms-part=models style="padding:0; max-height:80vh; overflow:auto">${models(node, { vars })}</div>
  </div>

</div>`;
}

export async function backendDashboardWidget(app: App): Promise<HtmlString> {
  const models = await app.db.query`\n    SELECT m.kind, m.model_id, p.name AS provider, m.is_default, m.used_input_tokens, m.used_output_tokens
    FROM ai_provider_model m JOIN ai_provider p ON p.id = m.provider_id ORDER BY m.kind, p.name`;

  const defaultRows = models.filter((m) => m.is_default)
    .map((m) => html`<tr>
      <td>${m.kind}:
      <td>${`${m.provider} · ${m.model_id}`}`);
  const defaults = defaultRows.length ? html.join(defaultRows) : html`<tr><td colspan=2 style="color:#999">No default configured.`;

  const trs = [];
  for (const m of models) {
    const input = Number(m.used_input_tokens), output = Number(m.used_output_tokens);
    if (!input && !output) continue;
    trs.push(html`<tr>
      <td>${m.model_id}
      <td style="text-align:right">${input.toLocaleString("de-DE")}
      <td style="text-align:right">${output.toLocaleString("de-DE")}`);
  }

  return html`<div style="overflow:auto; padding:0">
<table class=u2-table style="white-space:nowrap">${defaults}</table>
${trs.length ? html`<table class=u2-table style="white-space:nowrap;margin-top:1px">
  <thead><tr>
    <th>Model
    <th style="text-align:right">Input
    <th style="text-align:right">Output
  <tbody>${trs}
</table>` : ""}
</div>`;
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    js: ["pub/main.js"],
    render,
    parts: { models },
  },
};
