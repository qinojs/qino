import { hee, getCtx, type Ctx, toJsonSchema, type StandardSchema, VERBS, RESERVED, camelName, toTools, Access, type Method, type AptNode, type Verb, type App } from "../core/mod.ts";
import { toInput } from "../../deps.ts";
import { backend } from "../cms.backend/mod.ts";

export const name = "cms.backend.api";
export const description = "Documents and interactively tests the application Apt API.";
export const needs = ["cms.backend"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, "cms.backend.api", { en: "API", de: "API" });
}

interface PathParam {
  name: string;
  schema?: StandardSchema;
}

interface Route {
  method: Method;
  path: string;
  name: string;
  description: string;
  input?: StandardSchema;
  query?: StandardSchema;
  output?: StandardSchema;
  pathParams: PathParam[];
  accessLevel: "public" | "user" | "superuser" | "dynamic" | "none";
}

function accessLevel(action: Verb, ctx: Ctx): Route["accessLevel"] {
  const { access, guard } = action;
  if (!access) return "none";
  if (guard) return "dynamic";
  if (access === Access.PUBLIC) return "public";
  if (access === Access.SUPERUSER) return "superuser";
  if (access === Access.USER) return "user";
  return access(ctx) ? "user" : "none";
}

function* walk(node: AptNode, ctx: Ctx, segments: string[] = [], nodes: AptNode[] = []): Generator<Route> {
  for (const [key, value] of Object.entries(node)) {
    if (RESERVED.has(key) || value == null || typeof value !== "object") continue;
    const child = value as AptNode;
    const segs = [...segments, key];
    const childNodes = [...nodes, child];
    for (const verb of VERBS) {
      const action = child[verb];
      if (action && typeof action.execute === "function") {
        yield {
          method: verb,
          path: "/" + segs.join("/"),
          name: camelName(verb, segs),
          description: action.description ?? "",
          input: action.input,
          query: action.query,
          output: action.output,
          pathParams: segs.flatMap((s, i) => s.startsWith(":") ? [{ name: s.slice(1), schema: childNodes[i]?.paramSchema }] : []),
          accessLevel: accessLevel(action, ctx),
        };
      }
    }
    yield* walk(child, ctx, segs, childNodes);
  }
}


function schemaToFormFields(s: StandardSchema | undefined): string {
  if (!s || s.kind !== "object" || !s.shape) return "";
  return Object.entries(s.shape).map(([k, v]) => {
    const field = v as StandardSchema;
    const inner = field.kind === "optional" ? field.inner ?? field : field;
    const required = field.kind !== "optional" && !field.defaultValue;
    const isJson = inner.kind === "array" || inner.kind === "object" || inner.kind === "record";
    const jsonSchema = isJson
      ? { ...toJsonSchema(inner), "x-html": { tag: "textarea", "data-json": "1" }, examples: [inner.kind === "array" ? '["one", "two"]' : '{"key": "value"}'] }
      : toJsonSchema(inner);
    const description = field.description ?? inner.description;
    const inputHtml = toInput({ title: description, ...jsonSchema }, { name: k, required });
    const label = hee(k) + (required ? "" : "?");
    return `
      <label class=-field>
        <span>
          ${label}
          <br>
          <small>${hee(description)}</small>
        </span>
        <span>${inputHtml}</span>
      </label>`;
  }).join("");
}

const ACCESS_COLORS: Record<Route["accessLevel"], string> = {
  public:    "var(--gray)",
  user:      "var(--purple)",
  superuser: "var(--orange)",
  dynamic:   "var(--blue)",
  none:      "var(--red)",
};

function pathParamFields(params: PathParam[]): string {
  return params.map(({ name, schema }) => {
    const jsonSchema = schema ? toJsonSchema(schema) : { type: "string" };
    const description = schema?.description;
    const inputHtml = toInput({ title: description, ...jsonSchema }, { name, required: true });
    return `<label class=-field><span>${hee(name)}</span><span>${inputHtml}</span></label>`;
  }).join("");
}

function routeHtml(r: Route, idx: number, toolJson: string): string {
  const accessColor = ACCESS_COLORS[r.accessLevel];
  const paramForm = pathParamFields(r.pathParams);
  const inputForm = schemaToFormFields(r.input);
  const queryForm = schemaToFormFields(r.query);
  const hasForm = r.pathParams.length || !!inputForm || !!queryForm;

  return `
  <h4>
    <span style="width:5rem">
      <small class="u2-badge -method -${hee(r.method)}">${hee(r.method.toUpperCase())}</small>
    </span>
    <code class=-path>${hee(r.path)}</code>
    <small class=-desc>${hee(r.description)}</small>
    <span class=-access style="color:${hee(accessColor)}">${hee(r.accessLevel)}</span>
  </h4>
  <div class="-body -route" data-idx="${idx}" data-method="${hee(r.method)}" data-path="${hee(r.path)}">
    <u2-tabs>
      <h3>Test</h3>
      <div>
        <form class="-form u2-table" style="width:auto">
          ${hasForm ? `
            ${r.pathParams.length ? `<div class=-section><b>Path params</b>${paramForm}</div>` : ""}
            ${inputForm           ? `<div class=-section><b>Body</b>${inputForm}</div>` : ""}
            ${queryForm           ? `<div class=-section><b>Query</b>${queryForm}</div>` : ""}
          ` : ""}
          <u2-buttongroup>
            <button type=submit>Send</button>
            <button type=button data-check-access="${idx}">Check access</button>
          </u2-buttongroup>
        </form>
        <u2-code id="api-result-${idx}"></u2-code>
      </div>
      <h3>Tool-Json</h3>
      <u2-code id="api-tool-${idx}">${hee(toolJson)}</u2-code>
    </u2-tabs>
  </div>`;
}

function render(): string {
  const ctx = getCtx();
  const appURL = ctx.req.basePath ?? "/";

  const aptTree = ctx.app.aptTree;
  const routes = [...walk(aptTree, ctx)];
  const tools = toTools(aptTree);
  const toolJsonByName = new Map(tools.map((t) => [t.name, JSON.stringify({ name: t.name, description: t.description, parameters: t.parameters }, null, 2)]));

  const routesJson = JSON.stringify(
    routes.map((r) => ({
      method: r.method,
      path: r.path,
      pathParams: r.pathParams.map((p) => p.name),
      hasInput: !!r.input,
      hasQuery: !!r.query,
    })),
  );

  const routesHtml = routes.map((r, i) => routeHtml(r, i, toolJsonByName.get(r.name) ?? "{}")).join("");

  return `
<div class=u2-card data-routes="${hee(routesJson)}" data-app-url="${hee(appURL)}">
  <div class="u2-flex -filter -head">
    API <input type=search placeholder="Filter routes…" id=api-search>
  </div>
  <div>
    <u2-accordion id=api-list>
      ${routesHtml}
    </u2-accordion>
  </div>
</div>`;
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    js: ["pub/main.js"],
    render,
  },
};
