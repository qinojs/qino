import { hee } from "../core/lib/util.ts"
import { getCtx, type RequestContext } from "../core/lib/RequestContext.ts";
import { toJsonSchema, type StandardSchema } from "../core/lib/StandardSchema.ts";
import { toInput } from "../../deps.ts";
import { backend } from "../cms.backend/mod.ts";
import { VERBS, RESERVED, camelName, toTools, isStaticAccess, Access, type Method, type AptNode, type Verb } from "../core/lib/apt/mod.ts";
import type { App } from "../core/server.ts";

export const name = "cms.backend.api";
export const needs = ["cms.backend"];

export async function install({ app }: { app: App }): Promise<void> {
  const P = await backend.install(app, "cms.backend.api");
  if (P) {
    await P.title("en", "API");
  }
}

interface Route {
  method: Method;
  path: string;
  name: string;
  description: string;
  input?: StandardSchema;
  query?: StandardSchema;
  output?: StandardSchema;
  pathParams: string[];
  accessLevel: "public" | "user" | "superuser" | "dynamic" | "none";
}

function accessLevel(action: Verb, ctx: RequestContext): Route["accessLevel"] {
  const { access } = action;
  if (!access) return "none";
  if (!isStaticAccess(access)) return "dynamic";
  if (access === Access.PUBLIC) return "public";
  if (access === Access.SUPERUSER) return "superuser";
  if (access === Access.USER) return "user";
  // custom static: evaluate now
  return access({}, ctx) ? "user" : "none";
}

function* walk(node: AptNode, ctx: RequestContext, segments: string[] = []): Generator<Route> {
  for (const [key, value] of Object.entries(node)) {
    if (RESERVED.has(key) || value == null || typeof value !== "object") continue;
    const segs = [...segments, key];
    for (const verb of VERBS) {
      const action = (value as AptNode)[verb];
      if (action && typeof action.execute === "function") {
        yield {
          method: verb,
          path: "/" + segs.join("/"),
          name: camelName(verb, segs),
          description: action.description ?? "",
          input: action.input,
          query: action.query,
          output: action.output,
          pathParams: segs.filter((s) => s.startsWith(":")).map((s) => s.slice(1)),
          accessLevel: accessLevel(action, ctx),
        };
      }
    }
    yield* walk(value as AptNode, ctx, segs);
  }
}

// ───── StandardSchema → readable text ─────────────────────────────────────────────

function schemaText(s: StandardSchema | undefined): string {
  if (!s) return "";
  switch (s.kind) {
    case "string":  return "string";
    case "number":  return "number";
    case "boolean": return "boolean";
    case "array":   return `${schemaText(s.inner)}[]`;
    case "record":  return s.inner ? `Record<string, ${schemaText(s.inner)}>` : "Record<string, unknown>";
    case "any":     return "any";
    case "optional": return schemaText(s.inner) + "?";
    case "object": {
      if (!s.shape) return "{}";
      const fields = Object.entries(s.shape).map(([k, v]) => {
        const schema = v as StandardSchema;
        const opt = schema.kind === "optional" || schema.defaultValue ? "?" : "";
        const def = schema.defaultValue ? `=${JSON.stringify(schema.defaultValue())}` : "";
        return `${k}${opt}: ${schemaText(v as StandardSchema)}${def}`;
      });
      return `{ ${fields.join(", ")} }`;
    }
    default: return s.kind;
  }
}

// ───── StandardSchema → form fields ───────────────────────────────────────────────

function schemaToFormFields(s: StandardSchema | undefined): string {
  if (!s || s.kind !== "object" || !s.shape) return "";
  return Object.entries(s.shape).map(([k, v]) => {
    const field = v as StandardSchema;
    const inner = field.kind === "optional" ? field.inner ?? field : field;
    const required = field.kind !== "optional" && !field.defaultValue;
    const jsonSchema = toJsonSchema(inner);
    const description = (field.description ?? inner.description) as string | undefined;
    const inputHtml = toInput({ title: description, ...jsonSchema }, { name: k, required });
    const label = hee(k) + (required ? "" : "?");
    return `<label class="api-field"><span>${label}</span>${inputHtml}</label>`;
  }).join("");
}

// ───── HTML helpers ───────────────────────────────────────────────────────

const METHOD_COLORS: Record<Method, string> = {
  get:    "#61affe",
  post:   "#49cc90",
  put:    "#fca130",
  delete: "#f93e3e",
  patch:  "#50e3c2",
};

const ACCESS_LABELS: Record<Route["accessLevel"], string> = {
  public:    "public",
  user:      "user",
  superuser: "superuser",
  dynamic:   "dynamic",
  none:      "none",
};

const ACCESS_COLORS: Record<Route["accessLevel"], string> = {
  public:    "#aaa",
  user:      "#7c3aed",
  superuser: "#b45309",
  dynamic:   "#0369a1",
  none:      "#dc2626",
};

function pathParamFields(params: string[]): string {
  return params.map((p) =>
    `<label class="api-field"><span>${hee(p)}</span>${toInput({ type: "string" }, { name: p, required: true })}</label>`
  ).join("");
}

function routeHtml(r: Route, idx: number, toolJson: string): string {
  const color = METHOD_COLORS[r.method];
  const accessColor = ACCESS_COLORS[r.accessLevel];
  const accessLabel = ACCESS_LABELS[r.accessLevel];
  const paramForm = pathParamFields(r.pathParams);
  const inputForm = schemaToFormFields(r.input);
  const queryForm = schemaToFormFields(r.query);

  const hasForm = r.pathParams.length || !!inputForm || !!queryForm;

  const outputText = r.output ? schemaText(r.output) : "";

  return `
<div class="api-route" data-idx="${idx}" data-method="${hee(r.method)}" data-path="${hee(r.path)}">
  <div class="api-route-head">
    <span class="api-badge" style="background:${hee(color)}">${hee(r.method.toUpperCase())}</span>
    <code class="api-path">${hee(r.path)}</code>
    <span class="api-desc">${hee(r.description)}</span>
    <span class="api-access" style="color:${hee(accessColor)}" title="access">${hee(accessLabel)}</span>
    <span class="api-arrow">▶</span>
  </div>
  <div class="api-route-body" id="api-body-${idx}" hidden>
    <div class="api-meta">
      ${r.input   ? `<div><b>Input:</b> <code>${hee(schemaText(r.input))}</code></div>` : ""}
      ${r.query   ? `<div><b>Query:</b> <code>${hee(schemaText(r.query))}</code></div>` : ""}
      ${outputText ? `<div><b>Output:</b> <code>${hee(outputText)}</code></div>` : ""}
    </div>
    ${hasForm ? `
    <form class="api-form">
      ${r.pathParams.length ? `<div class="api-section">Path params${paramForm}</div>` : ""}
      ${inputForm           ? `<div class="api-section">Body${inputForm}</div>` : ""}
      ${queryForm           ? `<div class="api-section">Query${queryForm}</div>` : ""}
      <button type="submit">Send ▶</button>
      <button type="button" data-check-access="${idx}">Check access</button>
    </form>` : `
    <form class="api-form">
      <button type="submit">Send ▶</button>
      <button type="button" data-check-access="${idx}">Check access</button>
    </form>`}
    <pre class="api-result" id="api-result-${idx}" hidden></pre>
    <div class="api-tool-section">
      <button class="api-tool-btn" type="button">As tool: &quot;${hee(r.name)}&quot;</button>
      <pre class="api-tool-json" id="api-tool-${idx}" hidden>${hee(toolJson)}</pre>
    </div>
  </div>
</div>`;
}

// ───── Main render ────────────────────────────────────────────────────────

function render(): string {
  const ctx = getCtx();
  const appURL: string = ctx.appURL ?? "/";

  const aptTree = ctx.app.aptTree;
  const routes = [...walk(aptTree, ctx)];
  const tools = toTools(aptTree);
  const toolJsonByName = new Map(tools.map((t) => [t.name, JSON.stringify({ name: t.name, description: t.description, parameters: t.parameters }, null, 2)]));

  const routesJson = JSON.stringify(
    routes.map((r) => ({
      method: r.method,
      path: r.path,
      pathParams: r.pathParams,
      hasInput: !!r.input,
      hasQuery: !!r.query,
    })),
  );

  const routesHtml = routes.map((r, i) => routeHtml(r, i, toolJsonByName.get(r.name) ?? "{}")).join("");

  return `
<div class="api-docs -m-cms-backend-api" data-routes="${hee(routesJson)}" data-app-url="${hee(appURL)}">
<style>
.api-docs { font-family: monospace; }
.api-filter { margin-bottom:12px; display:flex; gap:8px; align-items:center; }
.api-filter input { flex:1; padding:6px 10px; border:1px solid #ccc; border-radius:4px; font:inherit; }
.api-route { border:1px solid #ddd; border-radius:6px; margin-bottom:6px; overflow:hidden; }
.api-route-head { display:flex; align-items:center; gap:10px; padding:8px 12px; cursor:pointer; background:#f8f8f8; }
.api-route-head:hover { background:#f0f0f0; }
.api-badge { color:#fff; font-size:11px; font-weight:bold; padding:2px 8px; border-radius:3px; min-width:60px; text-align:center; flex-shrink:0; }
.api-path { font-size:14px; flex-shrink:0; }
.api-name { font-size:12px; color:#888; flex-shrink:0; }
.api-desc { color:#666; font-size:12px; flex:1; }
.api-access { font-size:11px; font-weight:bold; margin-left:auto; }
.api-arrow { transition:transform .15s; }
.api-route.open .api-arrow { transform:rotate(90deg); }
.api-route-body { padding:12px 16px; border-top:1px solid #eee; background:#fff; }
.api-meta { font-size:12px; color:#555; margin-bottom:10px; display:flex; flex-direction:column; gap:4px; }
.api-meta code { background:#f4f4f4; padding:1px 4px; border-radius:3px; }
.api-section { margin-bottom:8px; }
.api-section > b { display:block; font-size:11px; color:#999; text-transform:uppercase; margin-bottom:4px; }
.api-field { display:flex; align-items:center; gap:8px; margin-bottom:4px; font-size:13px; }
.api-field span { min-width:120px; color:#333; }
.api-field input, .api-field select { flex:1; padding:4px 8px; border:1px solid #ccc; border-radius:3px; font:inherit; }
.api-form button { margin-top:8px; padding:5px 16px; background:#333; color:#fff; border:none; border-radius:4px; cursor:pointer; font:inherit; }
.api-form button:hover { background:#000; }
.api-result { margin-top:10px; padding:10px; background:#1a1a2e; color:#a8ff78; border-radius:4px; font-size:12px; overflow:auto; max-height:300px; white-space:pre-wrap; }
.api-result.error { color:#ff6b6b; }
.api-tool-section { margin-top:8px; }
.api-tool-btn { padding:3px 10px; background:#555; color:#fff; border:none; border-radius:4px; cursor:pointer; font:inherit; font-size:11px; }
.api-tool-btn:hover { background:#333; }
.api-tool-json { margin-top:6px; padding:10px; background:#1a1a2e; color:#79c0ff; border-radius:4px; font-size:12px; overflow:auto; max-height:300px; white-space:pre-wrap; }
</style>

<div class="api-filter">
  <input type="search" placeholder="Filter routes…" id="api-search">
</div>

<div id="api-list">
${routesHtml}
</div>
</div>`;
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render,
  },
};
