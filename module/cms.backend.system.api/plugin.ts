import { html, getCtx, type Ctx, toInput, toJsonSchema, type StandardSchema, VERBS, RESERVED, camelName, toTools, Access, type Method, type ApiNode, type Verb, type App, type HtmlString } from "../core/mod.ts";
import { backend } from "../cms.backend/mod.ts";

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, "cms.backend.system.api", { en: "API", de: "API" });
}

type PathParam = {
  name: string;
  schema?: StandardSchema;
};

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

function* walk(node: ApiNode, ctx: Ctx, segments: string[] = [], nodes: ApiNode[] = []): Generator<Route> {
  for (const [key, value] of Object.entries(node)) {
    if (RESERVED.has(key) || value == null || typeof value !== "object") continue;
    const child = value as ApiNode;
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

function schemaToFormFields(s: StandardSchema | undefined): HtmlString | "" {
  if (!s || s.kind !== "object" || !s.shape) return "";
  return html.join(Object.entries(s.shape).map(([k, v]) => {
    const field = v as StandardSchema;
    const inner = field.kind === "optional" ? field.inner ?? field : field;
    const required = field.kind !== "optional" && !field.defaultValue;
    const isJson = inner.kind === "array" || inner.kind === "object" || inner.kind === "record";
    const jsonSchema = isJson
      ? { ...toJsonSchema(inner), "x-html": { tag: "textarea", "data-json": "1" }, examples: [inner.kind === "array" ? '["one", "two"]' : '{"key": "value"}'] }
      : toJsonSchema(inner);
    const description = field.description ?? inner.description;
    const inputHtml = toInput({ title: description, ...jsonSchema }, { name: k, required });
    return html`
      <label class=-field>
        <span>
          ${k + (required ? "" : "?")}
          <br>
          <small>${description}</small>
        </span>
        <span>${html.raw(inputHtml)}</span>
      </label>`;
  }));
}

const ACCESS_COLORS: Record<Route["accessLevel"], string> = {
  public:    "var(--gray)",
  user:      "var(--purple)",
  superuser: "var(--orange)",
  dynamic:   "var(--blue)",
  none:      "var(--red)",
};

function pathParamFields(params: PathParam[]): HtmlString {
  return html.join(params.map(({ name, schema }) => {
    const jsonSchema = schema ? toJsonSchema(schema) : { type: "string" };
    const description = schema?.description;
    const inputHtml = toInput({ title: description, ...jsonSchema }, { name, required: true });
    return html`<label class=-field><span>${name}</span><span>${html.raw(inputHtml)}</span></label>`;
  }));
}

function routeHtml(r: Route, idx: number, toolJson: string): HtmlString {
  const accessColor = ACCESS_COLORS[r.accessLevel];
  const paramForm = pathParamFields(r.pathParams);
  const inputForm = schemaToFormFields(r.input);
  const queryForm = schemaToFormFields(r.query);
  const hasForm = r.pathParams.length || !!inputForm || !!queryForm;

  return html`
  <h4>
    <span style="width:5rem">
      <small class="u2-badge -method -${r.method}">${r.method.toUpperCase()}</small>
    </span>
    <code class=-path>${r.path}</code>
    <small class=-desc>${r.description}</small>
    <span class=-access style="color:${accessColor}">${r.accessLevel}</span>
  </h4>
  <div class="-body -route" data-idx="${idx}" data-method="${r.method}" data-path="${r.path}">
    <u2-tabs>
      <h3>Test</h3>
      <div>
        <form class="-form u2-table" style="width:auto">
          ${hasForm ? html`
            ${r.pathParams.length ? html`<div class=-section><b>Path params</b>${paramForm}</div>` : ""}
            ${inputForm           ? html`<div class=-section><b>Body</b>${inputForm}</div>` : ""}
            ${queryForm           ? html`<div class=-section><b>Query</b>${queryForm}</div>` : ""}
          ` : ""}
          <u2-buttongroup>
            <button type=submit>Send</button>
            <button type=button data-check-access="${idx}">Check access</button>
          </u2-buttongroup>
        </form>
        <u2-code id="api-result-${idx}"></u2-code>
      </div>
      <h3>Tool-Json</h3>
      <u2-code id="api-tool-${idx}">${toolJson}</u2-code>
    </u2-tabs>
  </div>`;
}

function render(): HtmlString {
  const ctx = getCtx();
  const appUrl = ctx.req.appUrl ?? "/";

  const apiTree = ctx.app.apiTree;
  const routes = [...walk(apiTree, ctx)];
  const tools = toTools(apiTree);
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

  const routesHtml = html.join(routes.map((r, i) => routeHtml(r, i, toolJsonByName.get(r.name) ?? "{}")));

  return html`
<div class=u2-card data-routes="${routesJson}" data-app-url="${appUrl}">
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
