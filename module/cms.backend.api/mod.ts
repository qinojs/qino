// deno-lint-ignore-file no-explicit-any
import { hee } from "../core/lib/util.ts"
import { getCtx } from "../core/lib/RequestContext.ts";
import { toJsonSchema, type StandardSchema } from "../core/lib/StandardSchema.ts";
import { toInput } from "../../deps.ts";
import { backend } from "../cms.backend/mod.ts";
import { VERBS, RESERVED, camelName, toTools, isStaticAccess, Access, type Method } from "../core/lib/apt/mod.ts";

export const name = "cms.backend.api";
export const needs = ["cms.backend"];

export async function install({ app }: any): Promise<void> {
  const P = await backend.install(app, "cms.backend.api");
  if (P) {
    await P.title("en", "API");
    await P.title("de", "API");
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

function accessLevel(action: any, ctx: any): Route["accessLevel"] {
  const { access } = action;
  if (!access) return "none";
  if (!isStaticAccess(access)) return "dynamic";
  if (access === Access.PUBLIC) return "public";
  if (access === Access.SUPERUSER) return "superuser";
  if (access === Access.USER) return "user";
  // custom static: evaluate now
  return access({}, ctx) ? "user" : "none";
}

function* walk(node: any, ctx: any, segments: string[] = []): Generator<Route> {
  for (const [key, value] of Object.entries(node as object)) {
    if (RESERVED.has(key) || value == null || typeof value !== "object") continue;
    const segs = [...segments, key];
    for (const verb of VERBS) {
      const action = (value as any)[verb];
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
    yield* walk(value, ctx, segs);
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
        const opt = (v as StandardSchema).kind === "optional" || (v as any).defaultValue ? "?" : "";
        const def = (v as any).defaultValue ? `=${JSON.stringify((v as any).defaultValue())}` : "";
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
    const required = field.kind !== "optional" && !(field as any).defaultValue;
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
  <div class="api-route-head" onclick="apiToggle(${idx})">
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
    <form class="api-form" onsubmit="apiSubmit(event,${idx})">
      ${r.pathParams.length ? `<div class="api-section">Path params${paramForm}</div>` : ""}
      ${inputForm           ? `<div class="api-section">Body${inputForm}</div>` : ""}
      ${queryForm           ? `<div class="api-section">Query${queryForm}</div>` : ""}
      <button type="submit">Send ▶</button>
      <button type="button" onclick="apiCheckAccess(event,${idx})">Check access</button>
    </form>` : `
    <form class="api-form" onsubmit="apiSubmit(event,${idx})">
      <button type="submit">Send ▶</button>
      <button type="button" onclick="apiCheckAccess(event,${idx})">Check access</button>
    </form>`}
    <pre class="api-result" id="api-result-${idx}" hidden></pre>
    <div class="api-tool-section">
      <button class="api-tool-btn" type="button" onclick="apiToolToggle(${idx})">As tool: &quot;${hee(r.name)}&quot;</button>
      <pre class="api-tool-json" id="api-tool-${idx}" hidden>${hee(toolJson)}</pre>
    </div>
  </div>
</div>`;
}

// ───── Main render ────────────────────────────────────────────────────────

function render(): string {
  const ctx = getCtx() as any;
  const appURL: string = ctx.appURL ?? "/";

  const aptTree = (ctx.app as any).aptTree;
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
<div class="api-docs">
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
  <input type="search" placeholder="Filter routes…" oninput="apiFilter(this.value)" id="api-search">
</div>

<div id="api-list">
${routesHtml}
</div>

<script>
(function(){
  const routes = ${routesJson};
  const appURL = ${JSON.stringify(appURL)};

  window.apiToggle = function(idx) {
    const el = document.getElementById('api-body-' + idx);
    const route = el.closest('.api-route');
    const hidden = el.hidden;
    el.hidden = !hidden;
    route.classList.toggle('open', !hidden);
  };

  window.apiToolToggle = function(idx) {
    const el = document.getElementById('api-tool-' + idx);
    el.hidden = !el.hidden;
  };

  window.apiFilter = function(q) {
    q = q.toLowerCase();
    document.querySelectorAll('.api-route').forEach(function(el) {
      const text = el.querySelector('.api-path').textContent.toLowerCase()
        + ' ' + el.querySelector('.api-desc').textContent.toLowerCase()
        + ' ' + el.querySelector('.api-badge').textContent.toLowerCase();
      el.hidden = q && !text.includes(q);
    });
  };

  window.apiSubmit = async function(e, idx) {
    e.preventDefault();
    const r = routes[idx];
    const form = e.target;
    const result = document.getElementById('api-result-' + idx);
    result.hidden = false;
    result.textContent = 'Loading…';
    result.className = 'api-result';

    try {
      let path = r.path;
      const body = {};
      const query = {};

      for (const el of form.elements) {
        if (!el.name) continue;
        let val = el.value;
        if (val === '') continue;
        if (el.tagName === 'SELECT' && val === '') continue;
        if (val === 'true') val = true;
        else if (val === 'false') val = false;
        else if (!isNaN(val) && val !== '') val = Number(val);

        if (r.pathParams.includes(el.name)) {
          path = path.replace(':' + el.name, encodeURIComponent(val));
        } else if (r.hasQuery && !r.hasInput) {
          query[el.name] = val;
        } else {
          body[el.name] = val;
        }
      }

      const method = r.method.toUpperCase();
      const isBodyMethod = ['POST','PUT','PATCH'].includes(method);
      const qs = !isBodyMethod && Object.keys(body).length
        ? '?' + new URLSearchParams(Object.entries(body).map(([k,v]) => [k, String(v)])).toString()
        : Object.keys(query).length
        ? '?' + new URLSearchParams(Object.entries(query).map(([k,v]) => [k, String(v)])).toString()
        : '';
      const url = appURL + 'api' + path + qs;
      const opts = {
        method,
        headers: { 'Content-Type': 'application/json' },
      };
      if (isBodyMethod && Object.keys(body).length) {
        opts.body = JSON.stringify(body);
      }

      const res = await fetch(url, opts);
      const text = await res.text();
      let pretty;
      try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { pretty = text; }
      result.textContent = res.status + ' ' + res.statusText + '\\n\\n' + pretty;
      if (!res.ok) result.className = 'api-result error';
    } catch(err) {
      result.textContent = String(err);
      result.className = 'api-result error';
    }
  };

  window.apiCheckAccess = async function(e, idx) {
    const r = routes[idx];
    const form = e.target.closest('form');
    const result = document.getElementById('api-result-' + idx);
    result.hidden = false;
    result.className = 'api-result';
    try {
      let path = r.path;
      for (const p of r.pathParams) {
        const el = form.elements[p];
        if (!el || !el.value) {
          result.textContent = '⚠ fill in path param: ' + p;
          result.className = 'api-result error';
          return;
        }
        path = path.replace(':' + p, encodeURIComponent(el.value));
      }
      result.textContent = 'Checking…';
      const res = await fetch(appURL + 'api' + path + '?_checkAccess=1', { method: r.method.toUpperCase(), headers: { 'Content-Type': 'application/json' } });
      result.textContent = res.ok ? '✓ access granted' : '✗ ' + res.status + ' access denied';
      if (!res.ok) result.className = 'api-result error';
    } catch(err) {
      result.textContent = String(err);
      result.className = 'api-result error';
    }
  };
})();
</script>
</div>`;
}

export const cms = {
  node: {
    render,
  },
};
