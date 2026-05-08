// deno-lint-ignore-file no-explicit-any
/**
 * apt — Action Tree.
 *
 * Ein verschachtelter Baum beschreibt die gesamte API.
 * Adapter (REST, LLM-Tools, RPC) werden on the fly abgeleitet.
 *
 * Siehe ../../apt-concept.md
 */

import { Hono, type Context } from "../../../deps.ts";
import { getCtx } from "./context.ts";
import { toJsonSchema } from "./schema.ts";
import type { Schema, StandardIssue } from "./schema.ts";

// ───── Errors ─────────────────────────────────────────────────────────────

export class AccessError extends Error {
  status = 403;
  constructor(message = "Access denied") { super(message); this.name = "AccessError"; }
}

export class NotFoundError extends Error {
  status = 404;
  constructor(message = "Not found") { super(message); this.name = "NotFoundError"; }
}

export class ConflictError extends Error {
  status = 409;
  constructor(message = "Conflict") { super(message); this.name = "ConflictError"; }
}

export class ValidationError extends Error {
  status = 422;
  issues: readonly StandardIssue[];
  constructor(issues: readonly StandardIssue[], where = "input") {
    super(`Validation failed (${where})`);
    this.name = "ValidationError";
    this.issues = issues;
  }
}

// ───── Tree types ─────────────────────────────────────────────────────────

type Ctx = any;
type Params = Record<string, unknown>;

export interface Verb {
  description?: string;
  input?: Schema;
  query?: Schema;
  output?: Schema;
  execute(params: Params, ctx: Ctx): unknown | Promise<unknown>;
}

export interface Node {
  resolve?(raw: unknown, ctx: Ctx, parents: Params): unknown | Promise<unknown>;
  paramSchema?: Schema;
  get?: Verb;
  post?: Verb;
  put?: Verb;
  delete?: Verb;
  patch?: Verb;
  [child: string]: any;
}

export type Tree = Record<string, Node>;

export const VERBS = ["get", "post", "put", "delete", "patch"] as const;
export type Method = typeof VERBS[number];
const VERB_SET = new Set<string>(VERBS);
export const RESERVED = new Set<string>(["resolve", ...VERBS]);
const BODY_METHODS = new Set<Method>(["post", "put", "patch"]);

// ───── Route derivation ───────────────────────────────────────────────────

interface Route {
  method: Method;
  segments: string[];   // tree-level: literal or ":param"
  nodes: Node[];        // parallel to segments
  verb: Verb;
  name: string;         // camelCase: "createPageFile"
}

function* walk(tree: Tree, segments: string[] = [], nodes: Node[] = []): Generator<Route> {
  for (const [key, value] of Object.entries(tree)) {
    if (RESERVED.has(key) || typeof value !== "object" || value === null) continue;
    for (const verbKey of VERBS) {
      const verb = (value as Node)[verbKey];
      if (verb && typeof verb === "object" && typeof verb.execute === "function") {
        yield { method: verbKey, segments: [...segments, key], nodes: [...nodes, value], verb, name: camelName(verbKey, [...segments, key]) };
      }
    }
    yield* walk(value as Tree, [...segments, key], [...nodes, value]);
  }
}

const VERB_PREFIXES: Record<Method, string> = { get: "get", post: "create", put: "set", patch: "update", delete: "delete" };

export function camelName(verb: Method, segments: string[]): string {
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
  return VERB_PREFIXES[verb] + segments.filter((s) => !s.startsWith(":")).map((p) => p.split("-").map(cap).join("")).join("");
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
  for (const s of r.segments) if (s.startsWith(":")) add(s.slice(1), "path");
  for (const k of Object.keys(r.verb.input?.shape ?? {})) add(k, "input");
  for (const k of Object.keys(r.verb.query?.shape ?? {})) add(k, "query");
}

// ───── Core: invoke ───────────────────────────────────────────────────────

function validate(schema: Schema, data: unknown, where: string): unknown {
  const res = schema["~standard"].validate(data);
  if (res.issues) throw new ValidationError(res.issues, where);
  return res.value;
}

const pick = (obj: Params, keys: readonly string[] = []): Params =>
  Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));

export async function invoke(tree: Tree, method: string, path: string, rawParams: Params = {}): Promise<unknown> {
  const m = method.toLowerCase() as Method;
  if (!VERB_SET.has(m)) throw new NotFoundError(`no route: ${method} ${path}`);

  const segments: string[] = [];
  const nodes: Node[] = [];
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

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg.startsWith(":")) continue;
    const name = seg.slice(1);
    const node = nodes[i];
    let value: unknown = pathValues[name];
    if (node.paramSchema) value = validate(node.paramSchema, coerce(value, node.paramSchema), `param :${name}`);
    params[name] = node.resolve ? await node.resolve(value, ctx, params) : value;
  }

  for (const key of ["input", "query"] as const) {
    const schema = verb[key];
    if (!schema) continue;
    const picked = pick(rawParams, Object.keys(schema.shape ?? {}));
    for (const [k, fieldSchema] of Object.entries(schema.shape ?? {})) {
      if (k in picked) picked[k] = coerce(picked[k], fieldSchema as Schema);
    }
    Object.assign(params, validate(schema, picked, key));
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

function coerce(raw: unknown, schema: Schema): unknown {
  if (raw == null) return raw;
  const kind = schema.kind === "optional" ? schema.inner?.kind : schema.kind;
  if (kind === "number") { const n = Number(raw); return typeof raw === "number" || Number.isNaN(n) ? raw : n; }
  if (kind === "boolean") return raw === "true" || raw === "1" || raw === true;
  return raw;
}

// ───── Adapter 1: toHono ──────────────────────────────────────────────────

export function toHono(tree: Tree, app: Hono = new Hono()): Hono {
  for (const r of walk(tree)) checkCollisions(r);
  const handle = async (c: Context): Promise<Response> => {
    try {
      const path = "/" + (c.req.param("path") || "");
      const raw: Params = {};
      if (BODY_METHODS.has(c.req.method.toLowerCase() as Method)) {
        const body = await c.req.json().catch(() => ({}));
        if (body && typeof body === "object") Object.assign(raw, body);
      }
      Object.assign(raw, Object.fromEntries(new URL(c.req.url).searchParams));
      const result = await invoke(tree, c.req.method, path, raw);
      if (result === undefined) return new Response(null, { status: 204 });
      return c.json(result as any);
    } catch (e) {
      if (e instanceof ValidationError) return c.json({ error: e.message, issues: e.issues }, 422);
      if (e instanceof AccessError)     return c.json({ error: e.message }, 403);
      if (e instanceof NotFoundError)   return c.json({ error: e.message }, 404);
      console.error("[apt]", e);
      return c.json({ error: e instanceof Error ? e.message : String(e) || "Internal Server Error" }, 500);
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
  execute(args: unknown, ctx: unknown): Promise<unknown>;
}

export function toTools(tree: Tree, opts: { apis?: Record<string, Method[]> } = {}): Tool[] {
  const tools: Tool[] = [];
  for (const r of walk(tree)) {
    checkCollisions(r);
    const pathStr = "/" + r.segments.join("/");
    if (opts.apis && !opts.apis[pathStr]?.includes(r.method)) continue;

    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (let i = 0; i < r.segments.length; i++) {
      const seg = r.segments[i];
      if (!seg.startsWith(":")) continue;
      const paramSchema = r.nodes[i]?.paramSchema;
      properties[seg.slice(1)] = paramSchema ? toJsonSchema(paramSchema) : { type: "string" };
      required.push(seg.slice(1));
    }
    for (const schema of [r.verb.input, r.verb.query]) {
      if (!schema?.shape) continue;
      for (const [k, field] of Object.entries(schema.shape)) {
        properties[k] = toJsonSchema(field);
        if (field.kind !== "optional" && !field.defaultValue) required.push(k);
      }
    }

    tools.push({
      name: r.name,
      description: r.verb.description ?? r.name,
      parameters: { type: "object", properties, required },
      execute: (args) => {
        const raw = (args && typeof args === "object") ? { ...args as Params } : {};
        for (let i = 0; i < r.segments.length; i++) {
          const seg = r.segments[i];
          if (!seg.startsWith(":")) continue;
          const name = seg.slice(1);
          const schema = r.nodes[i]?.paramSchema;
          if (schema && name in raw) raw[name] = coerce(raw[name], schema);
        }
        const concretePath = r.segments
          .map((seg) => seg.startsWith(":") ? String(raw[seg.slice(1)] ?? "") : seg)
          .join("/");
        return invoke(tree, r.method, "/" + concretePath, raw);
      },
    });
  }
  return tools;
}

// ───── Adapter 3: client (RPC proxy) ──────────────────────────────────────

/**
 * Returns a proxy that mirrors the tree.
 *   rpc.page(42).copy.post({ deep: true })
 *   rpc.page(42).file("logo.png").meta.get()
 *
 * TODO: type-inferred Client<T>. For now, `any`.
 */
export function client(tree: Tree): any {
  function buildProxy(node: any, pathSoFar: string[]): any {
    return new Proxy(function () {}, {
      get(_t, prop: string | symbol) {
        if (typeof prop !== "string" || prop === "then") return undefined;
        if (VERB_SET.has(prop) && node?.[prop]?.execute) {
          return (body?: unknown, query?: unknown) => {
            const params: Params = {};
            if (body  && typeof body  === "object") Object.assign(params, body);
            if (query && typeof query === "object") Object.assign(params, query);
            return invoke(tree, prop, "/" + pathSoFar.join("/"), params);
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

// ───── Convenience: simple access helper ──────────────────────────────────

export async function require(resource: { access(): number | Promise<number> }, level: number): Promise<void> {
  if ((await resource.access()) < level) throw new AccessError();
}
