console.log('old, deprecated, not used?')
// deno-lint-ignore-file no-explicit-any
/**
 * apt — Action Tree.
 *
 * Ein verschachtelter Baum beschreibt die gesamte API.
 * Adapter (REST, LLM-Tools, RPC) werden on the fly abgeleitet.
 */

import { Hono, type Context } from "../../../deps.ts";
import { getCtx, type RequestContext } from "./RequestContext.ts";
import { AnswerError } from "./util.ts";
import { toJsonSchema, type StandardSchema, type StandardIssue } from "./StandardSchema.ts";

// ───── Errors ─────────────────────────────────────────────────────────────

export class AptError extends Error {
  constructor(public readonly status: number, message: string, public readonly issues?: readonly StandardIssue[]) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class AccessError extends AptError { constructor(message = "Access denied") { super(403, message); } }
export class NotFoundError extends AptError { constructor(message = "Not found") { super(404, message); } }
export class ConflictError extends AptError { constructor(message = "Conflict") { super(409, message); } }
export class ValidationError extends AptError {
  constructor(issues: readonly StandardIssue[], where = "input") {
    super(422, `Validation failed (${where})`, issues);
  }
}

// ───── Tree types ─────────────────────────────────────────────────────────

type Params = Record<string, unknown>;

export interface Verb {
  description?: string;
  input?: StandardSchema;
  query?: StandardSchema;
  output?: StandardSchema;
  access?: (params: Params, ctx: RequestContext) => boolean | Promise<boolean>;
  execute(params: Params, ctx: RequestContext): unknown | Promise<unknown>;
}

export const staticAccessKey = Symbol("staticAccess");

function staticAccess(fn: NonNullable<Verb["access"]>) {
  return Object.assign(fn, { [staticAccessKey]: true as const });
}

export function isStaticAccess(fn: NonNullable<Verb["access"]>): boolean {
  return (fn as any)[staticAccessKey] === true;
}

export const Access = {
  PUBLIC:    staticAccess(() => true),
  USER:      staticAccess((_: Params, ctx: RequestContext) => ctx.user !== null),
  SUPERUSER: staticAccess((_: Params, ctx: RequestContext) => ctx.user?.get?.("superuser").then(Boolean) ?? Promise.resolve(false)),
} satisfies Record<string, NonNullable<Verb["access"]>>;

export interface AptNode {
  resolve?(raw: unknown, ctx: RequestContext, parents: Params): unknown | Promise<unknown>;
  paramSchema?: StandardSchema;
  get?: Verb;
  post?: Verb;
  put?: Verb;
  delete?: Verb;
  patch?: Verb;
  [child: string]: any;
}

export type AptTree = Record<string, AptNode>;

export const VERBS = ["get", "post", "put", "delete", "patch"] as const;
export type Method = typeof VERBS[number];
const VERB_SET = new Set<string>(VERBS);
export const RESERVED = new Set<string>(["resolve", ...VERBS]);
const BODY_METHODS = new Set<Method>(["post", "put", "patch"]);
const shapeOf = (schema?: StandardSchema): Record<string, StandardSchema> => schema?.shape ?? {};

// ───── Route derivation ───────────────────────────────────────────────────

interface Route {
  method: Method;
  segments: string[];  // literal or ":param"
  nodes: AptNode[];    // parallel to segments
  verb: Verb;
  name: string;        // camelCase: "createPageFile"
}

function routeParams(r: Route): [string, StandardSchema | undefined][] {
  return r.segments.flatMap((seg, i) =>
    seg.startsWith(":") ? [[seg.slice(1), r.nodes[i]?.paramSchema] as [string, StandardSchema | undefined]] : []
  );
}

function* walk(tree: AptTree, segments: string[] = [], nodes: AptNode[] = []): Generator<Route> {
  for (const [key, value] of Object.entries(tree)) {
    if (RESERVED.has(key) || typeof value !== "object" || value === null) continue;
    for (const verbKey of VERBS) {
      const verb = (value as AptNode)[verbKey];
      if (verb && typeof verb === "object" && typeof verb.execute === "function") {
        yield { method: verbKey, segments: [...segments, key], nodes: [...nodes, value], verb, name: camelName(verbKey, [...segments, key]) };
      }
    }
    yield* walk(value as AptTree, [...segments, key], [...nodes, value]);
  }
}

export function camelName(verb: Method, segments: string[]): string {
  const parts = [verb, ...segments.filter((s) => !s.startsWith(":"))];
  return parts.map((p) => p.replace(/[-.]([a-z])/g, (_, c) => c.toUpperCase())).join("_");
}

// ───── Setup-time checks ──────────────────────────────────────────────────

function checkCollisions(r: Route): void {
  const seen = new Map<string, string>();
  const add = (name: string, source: string) => {
    if (seen.has(name)) throw new Error(
      `apt setup error at ${r.method.toUpperCase()} /${r.segments.join("/")}: ` +
      `param name "${name}" appears in both ${seen.get(name)} and ${source} — rename one`,
    );
    seen.set(name, source);
  };
  for (const [name] of routeParams(r)) add(name, "path");
  for (const k of Object.keys(shapeOf(r.verb.input))) add(k, "input");
  for (const k of Object.keys(shapeOf(r.verb.query))) add(k, "query");
}

// ───── Core: invoke ───────────────────────────────────────────────────────

function validate(schema: StandardSchema, data: unknown, where: string): unknown {
  const res = schema["~standard"].validate(data);
  if (res.issues) throw new ValidationError(res.issues, where);
  return res.value;
}

const pick = (obj: Params, keys: readonly string[] = []): Params =>
  Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));
const asParams = (v: unknown): Params => v && typeof v === "object" ? v as Params : {};

export async function invoke(tree: AptTree, method: string, path: string, rawParams: Params = {}): Promise<unknown> {
  const m = method.toLowerCase() as Method;
  if (!VERB_SET.has(m)) throw new NotFoundError(`no route: ${method} ${path}`);

  const segments: string[] = [];
  const nodes: AptNode[] = [];
  const pathValues: Record<string, unknown> = {};

  let cursor: any = tree;
  for (const seg of path.split("/").filter(Boolean).map(decodeSegment)) {
    if (cursor[seg] && typeof cursor[seg] === "object" && !RESERVED.has(seg)) {
      cursor = cursor[seg];
      segments.push(seg);
    } else {
      const paramKey = Object.keys(cursor).find((k) => k.startsWith(":") && typeof cursor[k] === "object");
      if (!paramKey) throw new NotFoundError(`no route: ${method} ${path}`);
      pathValues[paramKey.slice(1)] = seg;
      cursor = cursor[paramKey];
      segments.push(paramKey);
    }
    nodes.push(cursor);
  }

  const verb = cursor?.[m];
  if (!verb || typeof verb.execute !== "function") throw new NotFoundError(`no ${method} on ${path}`);

  const ctx = getCtx();
  const params: Params = {};
  const isSplit = "input" in rawParams || "query" in rawParams;
  const input = isSplit ? asParams(rawParams.input) : rawParams;
  const query = isSplit ? asParams(rawParams.query) : rawParams;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg.startsWith(":")) continue;
    const name = seg.slice(1);
    const node = nodes[i];
    let value: unknown = pathValues[name];
    if (node.paramSchema) value = validate(node.paramSchema, coerce(value, node.paramSchema), `param :${name}`);
    params[name] = node.resolve ? await node.resolve(value, ctx, params) : value;
  }

  if (!verb.access) throw new AccessError("no access defined");
  if (!await verb.access(params, ctx)) throw new AccessError();
  if (rawParams._checkAccess || input._checkAccess || query._checkAccess) return { ok: true };

  if (verb.input) {
    Object.assign(params, validate(verb.input, pick(input, Object.keys(shapeOf(verb.input))), "input"));
  }
  if (verb.query) {
    const queryShape = shapeOf(verb.query);
    const picked = pick(query, Object.keys(queryShape));
    for (const [k, fieldSchema] of Object.entries(queryShape)) if (k in picked) picked[k] = coerce(picked[k], fieldSchema);
    Object.assign(params, validate(verb.query, picked, "query"));
  }
  const result = await verb.execute(params, ctx);

  if (verb.output) {
    const res = verb.output["~standard"].validate(result);
    if (res.issues) console.warn(`[apt] output validation failed at ${m} ${path}:`, res.issues);
  }

  return result;
}

function decodeSegment(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

function coerce(raw: unknown, schema: StandardSchema): unknown {
  if (raw == null) return raw;
  const kind = schema.kind === "optional" ? schema.inner?.kind : schema.kind;
  const inner = schema.kind === "optional" ? schema.inner?.inner : schema.inner;
  if (kind === "array" && Array.isArray(raw) && inner) return raw.map((v) => coerce(v, inner));
  if (kind === "number" && typeof raw === "string") {
    const s = raw.trim();
    return /^[-+]?(?:\d+|\d*\.\d+)(?:e[-+]?\d+)?$/i.test(s) ? Number(s) : raw;
  }
  if (kind === "boolean" && typeof raw === "string") {
    if (raw === "true" || raw === "1") return true;
    if (raw === "false" || raw === "0" || raw === "") return false;
  }
  return raw;
}

// ───── Adapter 1: toHono ──────────────────────────────────────────────────

export function toHono(tree: AptTree, app: Hono = new Hono()): Hono {
  for (const r of walk(tree)) checkCollisions(r);
  const handle = async (c: Context): Promise<Response> => {
    const path = "/" + (c.req.param("path") || "");
    const input: Params = {};
    const query: Params = {};
    if (BODY_METHODS.has(c.req.method.toLowerCase() as Method)) {
      const body = await c.req.json().catch(() => ({}));
      if (body && typeof body === "object") Object.assign(input, body);
    }
    const searchParams = new URL(c.req.url).searchParams;
    for (const key of new Set(searchParams.keys())) {
      const vals = searchParams.getAll(key);
      query[key] = vals.length === 1 ? vals[0] : vals;
    }
    if (!BODY_METHODS.has(c.req.method.toLowerCase() as Method)) Object.assign(input, query);
    try {
      const result = await invoke(tree, c.req.method, path, { input, query });
      throw new AnswerError(result === undefined ? {} : result as Record<string, unknown>, result === undefined ? 204 : 200);
    } catch (e) {
      if (e instanceof AnswerError) throw e;
      if (e instanceof AptError)    throw new AnswerError({ error: e.message, ...(e.issues && { issues: e.issues }) }, e.status);
      console.error("[apt]", e);
      throw new AnswerError({ error: e instanceof Error ? e.message : String(e) || "Internal Server Error" }, 500);
    }
  };
  app.all("/", handle);
  app.all("/:path{.*}", handle);
  return app;
}

// ───── Adapter 2: toTools ─────────────────────────────────────────────────

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: unknown, ctx: RequestContext): Promise<unknown>;
}

export function toTools(tree: AptTree, opts: { apis?: Record<string, Method[]> } = {}): Tool[] {
  const tools: Tool[] = [];
  for (const r of walk(tree)) {
    checkCollisions(r);
    const pathStr = "/" + r.segments.join("/");
    if (opts.apis && !opts.apis[pathStr]?.includes(r.method)) continue;

    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [name, paramSchema] of routeParams(r)) {
      properties[name] = paramSchema ? toJsonSchema(paramSchema) : { type: "string" };
      required.push(name);
    }
    for (const schema of [r.verb.input, r.verb.query]) {
      for (const [k, field] of Object.entries(shapeOf(schema))) {
        properties[k] = toJsonSchema(field);
        if (field.kind !== "optional" && !field.defaultValue) required.push(k);
      }
    }

    const hasParams = Object.keys(properties).length > 0;
    tools.push({
      name: r.name,
      description: r.verb.description ?? r.name,
      parameters: hasParams ? { type: "object", properties, required } : {},
      execute: (args) => {
        const raw = { ...asParams(args) };
        for (const [name, schema] of routeParams(r)) if (schema && name in raw) raw[name] = coerce(raw[name], schema);
        const concretePath = r.segments
          .map((seg) => seg.startsWith(":") ? String(raw[seg.slice(1)] ?? "") : seg)
          .join("/");
        return invoke(tree, r.method, "/" + concretePath, { input: raw, query: raw });
      },
    });
  }
  return tools;
}

// ───── Adapter 3: client (RPC proxy) ──────────────────────────────────────

export type AptProxy ={ [key: string]: AptProxy } & ((...args: unknown[]) => AptProxy) & { [K in Method]: (params?: Params) => Promise<unknown> };

/**
 * Returns a proxy that mirrors the tree.
 *   rpc.page(42).copy.post({ deep: true })
 *   rpc.page(42).file("logo.png").meta.get()
 */
export function aptClient(tree: AptTree): AptProxy {
  function buildProxy(node: any, pathSoFar: string[]): any {
    return new Proxy(function () {}, {
      get(_t, prop: string | symbol) {
        if (typeof prop !== "string" || prop === "then") return undefined;
        if (VERB_SET.has(prop) && node?.[prop]?.execute) {
          return (body?: unknown, query?: unknown) => {
            return invoke(tree, prop, "/" + pathSoFar.join("/"), {
              input: asParams(body),
              query: asParams(query),
            });
          };
        }
        const child = node?.[prop];
        if (!child || typeof child !== "object") return undefined;
        return buildProxy(child, [...pathSoFar, prop]);
      },
      apply(_t, _thisArg, args: unknown[]) {
        const paramKey = node ? Object.keys(node).find((k) => k.startsWith(":")) : undefined;
        if (!paramKey) throw new Error(`apt rpc: no :param under /${pathSoFar.join("/")}`);
        return buildProxy(node[paramKey], [...pathSoFar, String(args[0])]);
      },
    });
  }
  return buildProxy(tree, []);
}
