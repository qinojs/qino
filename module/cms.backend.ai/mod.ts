// deno-lint-ignore-file no-explicit-any

import { hee } from "../core/lib/util.ts"
import { getCtx } from "../core/lib/RequestContext.ts";
import type { ProviderModel, ProviderStrength } from "../ai/types.ts";
import {
  customProviderModels,
  parseProviderModels,
  providerModels,
} from "../ai/lib/providerModels.ts";
import { providers } from "../ai/lib/providers.ts";
import { backend } from "../cms.backend/mod.ts";

export const name = "cms.backend.ai";
export const needs = ["cms.backend", "ai"];

export async function install({ app }: any): Promise<void> {
  const P = await backend.install(app, "cms.backend.ai");
  if (P) {
    await P.title("en", "AI");
    await P.title("de", "KI");
  }
}

type Message = { type: "ok" | "error"; text: string };

const modelSyncProviders: Record<string, { label: string; source: string; requiresKey?: boolean }> = {
  "groq.com":       { label: "Groq",       source: "groq-sync",       requiresKey: true },
  "openai.com":     { label: "OpenAI",     source: "openai-sync",     requiresKey: true },
  "nvidia.com":     { label: "NVIDIA",     source: "nvidia-sync" },
  "openrouter.ai":  { label: "OpenRouter", source: "openrouter-sync" },
  "x-ai":           { label: "xAI",        source: "x-ai-sync",       requiresKey: true },
  "aihubmix.com":   { label: "AiHubMix",   source: "aihubmix-sync",   requiresKey: true },
};

function sourceLabel(source: string | undefined): string | undefined {
  if (!source) return undefined;
  for (const config of Object.values(modelSyncProviders)) {
    if (config.source === source) return `${config.label} Sync`;
  }
  return source;
}

function splitCsv(value: unknown): string[] {
  return String(value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

function asPositiveNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function pricePerMillion(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1_000_000 * 1_000_000) / 1_000_000 : undefined;
}

function htmlId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function modelFromPost(post: Record<string, unknown>): ProviderModel | null {
  const id = String(post.model_id ?? "").trim();
  if (!id) return null;
  return {
    id,
    label: String(post.model_label ?? "").trim() || undefined,
    strengths: splitCsv(post.model_strengths) as ProviderStrength[],
    maxInputTokens: asPositiveNumber(post.max_input_tokens),
    maxOutputTokens: asPositiveNumber(post.max_output_tokens),
    costPerMToken: asPositiveNumber(post.cost_per_m_token),
    inputCostPerMToken: asPositiveNumber(post.input_cost_per_m_token),
    outputCostPerMToken: asPositiveNumber(post.output_cost_per_m_token),
    supports: {
      streaming: "supports_streaming" in post,
      tools: "supports_tools" in post,
      vision: "supports_vision" in post,
      jsonMode: "supports_jsonMode" in post,
    },
  };
}

function pill(text: string, mod = ""): string {
  return `<span class="ai-pill${mod}">${hee(text)}</span>`;
}

function formatList(values: unknown[] | undefined): string {
  return values?.length ? values.map((v) => pill(String(v))).join("") : "";
}

function formatSupports(model: ProviderModel): string {
  return formatList(
    Object.entries(model.supports ?? {}).filter(([, v]) => v).map(([k]) => k),
  );
}

function formatCosts(model: ProviderModel): string {
  const { inputCostPerMToken: i, outputCostPerMToken: o, costPerMToken: c } = model;
  if (i !== undefined || o !== undefined) {
    return [i !== undefined ? `in ${i}` : "", o !== undefined ? `out ${o}` : ""].filter(Boolean).join(" / ");
  }
  return c !== undefined ? String(c) : "";
}

function modelOptionHtml(models: ProviderModel[], selected: string): string {
  return models.map((m) =>
    `<option value="${hee(m.id)}"${m.id === selected ? " selected" : ""}>${hee(m.label ? `${m.label} (${m.id})` : m.id)}`
  ).join("");
}

function modelRow(providerName: string, model: ProviderModel, source: string, deletable: boolean, token: string): string {
  const limits = [
    model.maxInputTokens ? `in ${model.maxInputTokens}` : "",
    model.maxOutputTokens ? `out ${model.maxOutputTokens}` : "",
  ].filter(Boolean).join(" / ");
  const deleteForm = deletable
    ? `<form method=post style=margin:0>
        <input type=hidden name=qgToken value="${hee(token)}">
        <input type=hidden name=action value=delete-model>
        <input type=hidden name=provider value="${hee(providerName)}">
        <input type=hidden name=model_id value="${hee(model.id)}">
        <button>löschen</button>
      </form>`
    : "";
  return `<tr>
    <td><code>${hee(model.id)}</code>
    <td>${hee(model.label ?? "")}
    <td>${formatList(model.strengths)}
    <td>${formatSupports(model)}
    <td>${hee(limits)}
    <td>${hee(formatCosts(model))}
    <td>${hee(source)}
    <td>${deleteForm}`;
}

function modelRows(providerName: string, builtinModels: ProviderModel[], customModels: ProviderModel[], token: string): string {
  const builtinIds = new Set(builtinModels.map((m) => m.id));
  const rows = [
    ...builtinModels.map((m) => modelRow(providerName, m, "Code", false, token)),
    ...customModels.map((m) => {
      const src = sourceLabel(m.source) ?? (builtinIds.has(m.id) ? "Custom Override" : "Custom");
      return modelRow(providerName, m, src, true, token);
    }),
  ];
  return rows.length ? rows.join("") : `<tr><td colspan=8><em>Noch keine Models hinterlegt.</em>`;
}

async function saveCustomModels(app: any, providerName: string, models: ProviderModel[]): Promise<void> {
  app.settings.ai.provider[providerName].models = JSON.stringify(models, null, 2);
}

function inferStrengths(providerName: string, id: string, data: Record<string, any>): ProviderStrength[] {
  const lower = id.toLowerCase();
  const strengths = new Set<ProviderStrength>(providers[providerName]?.strengths ?? []);
  if (lower.includes("code") || lower.includes("coder")) strengths.add("coding");
  if (lower.includes("vision") || lower.includes("vl") || lower.includes("multimodal") || lower.includes("image")) strengths.add("vision");
  if (lower.includes("reason") || lower.includes("thinking") || lower.startsWith("o")) strengths.add("reasoning");
  if ((Number(data.context_window ?? data.context_length) || 0) >= 100_000) strengths.add("long-context");
  return [...strengths];
}

function toProviderModel(providerName: string, data: Record<string, any>, syncedAt: string): ProviderModel | null {
  const id = String(data.id ?? "").trim();
  if (!id) return null;

  if (providerName === "openrouter.ai") {
    const inputModalities: string[] = Array.isArray(data.architecture?.input_modalities) ? data.architecture.input_modalities.map(String) : [];
    const supportedParameters: string[] = Array.isArray(data.supported_parameters) ? data.supported_parameters.map(String) : [];
    const contextLength = asPositiveNumber(data.context_length ?? data.top_provider?.context_length);
    const maxOutputTokens = asPositiveNumber(data.top_provider?.max_completion_tokens);
    const inputCostPerMToken = pricePerMillion(data.pricing?.prompt);
    const outputCostPerMToken = pricePerMillion(data.pricing?.completion);
    const strengths: ProviderStrength[] = ["model-choice"];
    if (inputModalities.includes("image")) strengths.push("vision");
    if ((contextLength ?? 0) >= 100_000) strengths.push("long-context");
    if (inputCostPerMToken !== undefined && outputCostPerMToken !== undefined && inputCostPerMToken <= 0.5 && outputCostPerMToken <= 0.5) strengths.push("cost");
    return {
      id,
      label: String(data.name ?? "").trim() || undefined,
      source: modelSyncProviders["openrouter.ai"].source,
      syncedAt, strengths, maxInputTokens: contextLength, maxOutputTokens,
      inputCostPerMToken, outputCostPerMToken,
      costPerMToken: inputCostPerMToken !== undefined && outputCostPerMToken !== undefined
        ? Math.round(((inputCostPerMToken + outputCostPerMToken) / 2) * 1_000_000) / 1_000_000 // rough average; providers charge input cheaper than output
        : undefined,
      supports: {
        streaming: true,
        tools: supportedParameters.includes("tools"),
        vision: inputModalities.includes("image"),
        jsonMode: supportedParameters.includes("response_format"),
      },
    };
  }

  const lower = id.toLowerCase();
  return {
    id,
    label: String(data.name ?? "").trim() || undefined,
    source: modelSyncProviders[providerName].source,
    syncedAt,
    strengths: inferStrengths(providerName, id, data),
    maxInputTokens: asPositiveNumber(data.context_window ?? data.context_length),
    maxOutputTokens: asPositiveNumber(data.max_completion_tokens ?? data.max_output_tokens),
    supports: {
      streaming: true,
      tools: providers[providerName]?.supports?.toolChoiceAuto === true,
      toolChoiceAuto: providers[providerName]?.supports?.toolChoiceAuto === true,
      vision: lower.includes("vision") || lower.includes("vl") || lower.includes("multimodal"),
      jsonMode: !!providers[providerName]?.jsonMode,
    },
  };
}

async function syncProviderModels(app: any, providerName: string): Promise<Message> {
  const syncConfig = modelSyncProviders[providerName];
  if (!syncConfig) return { type: "error", text: "Dieser Provider unterstützt keinen Sync." };

  const provider = providers[providerName];
  const providerSettings = app.settings.ai.provider[providerName];
  const key = String(await providerSettings.key ?? "");
  if (syncConfig.requiresKey && !key) {
    return { type: "error", text: `${syncConfig.label} Sync braucht zuerst einen API-Key.` };
  }

  const response = await fetch(provider.endpoint + "/models", {
    headers: key ? { "authorization": "Bearer " + key } : {},
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    return { type: "error", text: `${syncConfig.label} Sync fehlgeschlagen: HTTP ${response.status}` };
  }

  const result = await response.json();
  if (!Array.isArray(result?.data)) {
    return { type: "error", text: `${syncConfig.label} Sync fehlgeschlagen: Unerwartete Antwort.` };
  }

  const syncedAt = new Date().toISOString();
  const syncedModels = result.data
    .map((d: unknown) => d && typeof d === "object" ? toProviderModel(providerName, d as Record<string, any>, syncedAt) : null)
    .filter((m: ProviderModel | null): m is ProviderModel => m !== null);

  const manualModels = parseProviderModels(await providerSettings.models).filter((m) => m.source !== syncConfig.source);
  const models = new Map<string, ProviderModel>();
  for (const m of syncedModels) models.set(m.id, m);
  for (const m of manualModels) models.set(m.id, m);
  await saveCustomModels(app, providerName, [...models.values()]);
  providerSettings.models_synced_at = syncedAt;

  return { type: "ok", text: `${syncedModels.length} ${syncConfig.label}-Models synchronisiert.` };
}

async function handlePost(app: any, post: Record<string, unknown>, token: string): Promise<Message | null> {
  if (!("action" in post)) return null;
  if (post.qgToken !== token) return { type: "error", text: "Ungültiges Formular-Token." };

  const action = String(post.action ?? "");

  if (action === "save-default") {
    const provider = String(post.default_provider ?? "").trim();
    if (!providers[provider]) return { type: "error", text: "Unbekannter Provider." };
    app.settings.ai.default.provider = provider;
    app.settings.ai.default.model = String(post.default_model ?? "").trim();
    return { type: "ok", text: "Default-Provider gespeichert." };
  }

  const provider = String(post.provider ?? "").trim();
  if (!providers[provider]) return { type: "error", text: "Unbekannter Provider." };
  const providerSettings = app.settings.ai.provider[provider];

  if (action === "sync-provider") return syncProviderModels(app, provider);

  if (action === "save-provider") {
    const key = String(post.api_key ?? "").trim();
    if (key) providerSettings.key = key;
    providerSettings.default_model = String(post.provider_default_model ?? "").trim();
    return { type: "ok", text: `Provider ${provider} gespeichert.` };
  }

  if (action === "add-model") {
    const model = modelFromPost(post);
    if (!model) return { type: "error", text: "Model-ID fehlt." };
    const models = parseProviderModels(await providerSettings.models).filter((m) => m.id !== model.id);
    models.push(model);
    await saveCustomModels(app, provider, models);
    return { type: "ok", text: `Model ${model.id} gespeichert.` };
  }

  if (action === "delete-model") {
    const modelId = String(post.model_id ?? "").trim();
    const models = parseProviderModels(await providerSettings.models).filter((m) => m.id !== modelId);
    await saveCustomModels(app, provider, models);
    return { type: "ok", text: `Model ${modelId} gelöscht.` };
  }

  return { type: "error", text: "Unbekannte Aktion." };
}

async function render(node: any): Promise<string> {
  const ctx = getCtx();
  const app = node.app as any;
  const message = await handlePost(app, ctx.post as Record<string, unknown>, ctx.token);

  const defaultProvider = String(await app.settings.ai.default.provider ?? "");
  const defaultModel = String(await app.settings.ai.default.model ?? "");

  const providerOptions = Object.keys(providers).map((name) =>
    `<option value="${hee(name)}"${name === defaultProvider ? " selected" : ""}>${hee(name)}`
  ).join("");

  const modelsByProvider = new Map<string, ProviderModel[]>();
  for (const name of Object.keys(providers)) {
    modelsByProvider.set(name, await providerModels(app, name));
  }

  let providerBoxes = "";
  for (const [providerName, provider] of Object.entries(providers)) {
    const providerSettings = app.settings.ai.provider[providerName];
    const key = String(await providerSettings.key ?? "");
    const usedInput = Number(await providerSettings.used_input_tokens ?? 0);
    const usedOutput = Number(await providerSettings.used_output_tokens ?? 0);
    const providerDefaultModel = String(await providerSettings.default_model ?? "");
    const modelsSyncedAt = String(await providerSettings.models_synced_at ?? "");
    const customModels = await customProviderModels(app, providerName);
    const effectiveModels = modelsByProvider.get(providerName) ?? [];
    const datalistId = `ai-models-${htmlId(providerName)}`;
    const modelCount = effectiveModels.length;
    const summaryDefaultModel = providerDefaultModel || provider.defaultModel || effectiveModels[0]?.id || "";
    const syncConfig = modelSyncProviders[providerName];
    const syncHtml = syncConfig ? `<form method=post class=ai-flex>
        <input type=hidden name=qgToken value="${hee(ctx.token)}">
        <input type=hidden name=action value=sync-provider>
        <input type=hidden name=provider value="${hee(providerName)}">
        <button>synchronisieren</button>
        ${modelsSyncedAt ? `<small>zuletzt: ${hee(modelsSyncedAt)}</small>` : ""}
      </form>` : "";

    providerBoxes += `
<details class="ai-provider"${providerName === defaultProvider ? " open" : ""}>
  <summary class="ai-provider-summary">
    ${hee(providerName)}
    <span class=ai-summary-pills>
      ${modelCount ? pill(`${modelCount.toLocaleString("de-DE")} Models`) : ""}
      ${pill(key ? "Key gesetzt" : "kein Key", ` -${key ? "ok" : "error"}`)}
      ${summaryDefaultModel ? pill(`Default: ${summaryDefaultModel}`) : ""}
    </span>
  </summary>
  <div class=ai-provider-panel>
    <section class=ai-provider-settings>
      <div class=ai-subbody>
        <form method=post class=ai-provider-form>
          <input type=hidden name=qgToken value="${hee(ctx.token)}">
          <input type=hidden name=action value=save-provider>
          <input type=hidden name=provider value="${hee(providerName)}">
          <table class="u2-table ai-kv">
            <tr><th>Endpoint<td><code>${hee(provider.endpoint)}</code>
            <tr><th>Stärken<td>${formatList(provider.strengths)}
            <tr><th>JSON Mode<td>${provider.jsonMode ? "ja" : "nein"}
            <tr><th>API-Key<td>
              <input name=api_key type=text autocomplete=new-password data-lpignore=true data-form-type=other readonly onfocus="this.removeAttribute('readonly')" value="${hee(key)}" placeholder="API-Key">
            <tr><th>Provider-Default<td>
              <input name=provider_default_model value="${hee(providerDefaultModel)}" list="${hee(datalistId)}">
              <datalist id="${hee(datalistId)}">${modelOptionHtml(effectiveModels, providerDefaultModel)}</datalist>
            <tr><th>Verbrauch (Tokens)<td>${hee(usedInput.toLocaleString("de-DE"))} input / ${hee(usedOutput.toLocaleString("de-DE"))} output
          </table>
          <div class=ai-autosave-state aria-live=polite></div>
        </form>
      </div>
    </section>
    <details class=ai-subdetails>
      <summary>Models (${hee(modelCount.toLocaleString("de-DE"))})</summary>
      <div class=ai-subbody>${syncHtml}</div>
      <div style="overflow:auto; padding:0">
        <table class="u2-table ai-model-table">
          <thead><tr><th>Model<th>Label<th>Stärken<th>Features<th>Limits<th>Kosten/M<th>Quelle<th>
          <tbody>${modelRows(providerName, provider.models ?? [], customModels, ctx.token)}
        </table>
      </div>
    </details>
    <details class=ai-subdetails>
      <summary>Model hinzufügen</summary>
      <div class=ai-subbody>
        <form method=post>
          <input type=hidden name=qgToken value="${hee(ctx.token)}">
          <input type=hidden name=action value=add-model>
          <input type=hidden name=provider value="${hee(providerName)}">
          <div class=ai-grid>
            <label>Model-ID <input required name=model_id placeholder="provider/model"></label>
            <label>Label <input name=model_label></label>
            <label>Stärken <input name=model_strengths placeholder="speed, reasoning"></label>
            <label>Max Input Tokens <input name=max_input_tokens inputmode=numeric></label>
            <label>Max Output Tokens <input name=max_output_tokens inputmode=numeric></label>
            <label>Input Kosten/M <input name=input_cost_per_m_token inputmode=decimal></label>
            <label>Output Kosten/M <input name=output_cost_per_m_token inputmode=decimal></label>
          </div>
          <div class=ai-flex>
            <label><input type=checkbox name=supports_streaming value=1> Streaming</label>
            <label><input type=checkbox name=supports_tools value=1> Tools</label>
            <label><input type=checkbox name=supports_vision value=1> Vision</label>
            <label><input type=checkbox name=supports_jsonMode value=1> JSON Mode</label>
          </div>
          <button>Model hinzufügen</button>
        </form>
      </div>
    </details>
  </div>
</details>`;
  }

  const messageHtml = message ? `<div class="ai-message -${hee(message.type)}">${hee(message.text)}</div>` : "";

  return `
<div class="u2-flex ai-page">
  <style>
    .ai-provider-list { display:grid; gap:8px; }
    .ai-provider { border:1px solid #ddd; background:#fff; }
    .ai-provider[open] { border-color:#bbb; }
    .ai-provider-summary { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:9px 12px; cursor:pointer; user-select:none; background:#f3f3f3; font-weight:bold; }
    .ai-summary-pills { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:4px; font-weight:normal; }
    .ai-provider-panel { padding:8px; display:grid; gap:8px; }
    .ai-provider-settings, .ai-subdetails { border:1px solid #e5e5e5; }
    .ai-subdetails > summary { cursor:pointer; padding:7px 9px; background:#fafafa; font-weight:bold; }
    .ai-subbody { padding:9px; }
    .ai-message { flex:1 1 100%; padding:8px 12px; border:1px solid #ddd; background:#f7f7f7; }
    .ai-message.-ok { border-color:#7aa66c; background:#edf7e9; }
    .ai-message.-error { border-color:#b45b5b; background:#faecec; }
    .ai-pill { display:inline-block; margin:0 4px 4px 0; padding:2px 6px; border-radius:3px; background:#eee; white-space:nowrap; }
    .ai-pill.-ok { background:#d4edda; color:#2d6a3f; }
    .ai-pill.-error { background:#f8d7da; color:#842029; }
    .ai-kv th { width:160px; }
    .ai-provider-form input[list], .ai-provider-form input[name=api_key], .ai-grid input { width:100%; box-sizing:border-box; }
    .ai-autosave-state { min-height:1.4em; margin-top:6px; color:#666; font-size:.9em; }
    .ai-autosave-state.-error { color:#a33; }
    .ai-model-table th, .ai-model-table td { vertical-align:top; }
    .ai-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:8px; margin-bottom:8px; }
    .ai-grid label { display:grid; gap:3px; }
    .ai-flex { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin:0 0 10px; white-space:nowrap; }
  </style>

  ${messageHtml}

  <div class=u2-card style="flex-grow:0">
    <div class=-head>AI Defaults</div>
    <div class=-body style="padding:0">
      <form method=post>
        <input type=hidden name=qgToken value="${hee(ctx.token)}">
        <input type=hidden name=action value=save-default>
        <table class=u2-table>
          <tr><th>Provider<td><select name=default_provider>${providerOptions}</select>
          <tr><th>Model<td>
            <input name=default_model value="${hee(defaultModel)}" list="ai-models-${htmlId(defaultProvider)}-default">
            ${[...modelsByProvider.entries()].map(([n, ms]) =>
              `<datalist id="ai-models-${htmlId(n)}-default">${modelOptionHtml(ms, defaultModel)}</datalist>`
            ).join("")}
          <tr><th><td><button>Defaults speichern</button>
        </table>
      </form>
    </div>
  </div>

  <div class=u2-card>
    <div class=-head>Provider</div>
    <div class="-body ai-provider-list">
      ${providerBoxes}
    </div>
  </div>
  <script>
  (() => {
    const timers = new WeakMap();
    const save = async (form) => {
      const state = form.querySelector('.ai-autosave-state');
      if (state) { state.classList.remove('-error'); state.textContent = 'speichert...'; }
      try {
        const r = await fetch(location.href, { method: 'POST', body: new FormData(form), credentials: 'same-origin' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        if (state) state.textContent = 'gespeichert';
      } catch {
        if (state) { state.classList.add('-error'); state.textContent = 'Fehler beim Speichern'; }
      }
    };
    const schedule = (form, delay = 600) => {
      clearTimeout(timers.get(form));
      timers.set(form, setTimeout(() => save(form), delay));
    };
    for (const form of document.querySelectorAll('.ai-provider-form')) {
      form.addEventListener('submit', (e) => { e.preventDefault(); save(form); });
      for (const field of form.querySelectorAll('input, select, textarea')) {
        if (field.type === 'hidden') continue;
        field.addEventListener('input', () => schedule(form));
        field.addEventListener('change', () => schedule(form, 0));
      }
    }
  })();
  (() => {
    const sel = document.querySelector('select[name=default_provider]');
    const inp = document.querySelector('input[name=default_model]');
    if (!sel || !inp) return;
    const update = () => {
      inp.setAttribute('list', 'ai-models-' + sel.value.replace(/[^a-zA-Z0-9_-]/g, '-') + '-default');
      for (const d of document.querySelectorAll('.ai-provider')) {
        if (d.querySelector('summary')?.childNodes[0]?.textContent?.trim() === sel.value) d.open = true;
      }
    };
    sel.addEventListener('change', update);
    update();
  })();
  </script>
</div>`;
}

export async function backendDashboardWidget(app: any): Promise<string> {
  const defaultProvider = String(await app.settings.ai.default.provider ?? "");
  const defaultModel    = String(await app.settings.ai.default.model    ?? "");

  let rows = "";
  for (const name of Object.keys(providers)) {
    const s = app.settings.ai.provider[name];
    const input  = Number(await s.used_input_tokens  ?? 0);
    const output = Number(await s.used_output_tokens ?? 0);
    if (!input && !output) continue;
    rows += `<tr><td>${hee(name)}<td style="text-align:right">${hee(input.toLocaleString("de-DE"))}<td style="text-align:right">${hee(output.toLocaleString("de-DE"))}`;
  }

  const defaultHtml = defaultProvider
    ? `<tr><td>Provider:<td>${hee(defaultProvider)}
       <tr><td>Model:<td>${hee(defaultModel || "–")}`
    : `<tr><td colspan=2 style="color:#999">Kein Default konfiguriert.`;

  return `<div style="overflow:auto; padding:0">
<table class="u2-table" style="white-space:nowrap">
  ${defaultHtml}
</table>
${rows ? `<table class="u2-table" style="white-space:nowrap;margin-top:1px">
  <thead><tr><th>Provider<th style="text-align:right">Input<th style="text-align:right">Output
  <tbody>${rows}
</table>` : ""}
</div>`;
}

export const cms = { node: { render } };
