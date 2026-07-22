import { getCtx } from "../ctx/Ctx.ts";
import type { StandardSchema } from "../StandardSchema.ts";
import { AccessError, NotFoundError, ValidationError } from "./errors.ts";
import { BODY_METHODS, RESERVED, VERB_SET, type AptNode, type AptTree, type Method, type Params, type Verb } from "./types.ts";
import { isCatchall, paramName, shapeOf } from "./route.ts";

type Branch = Record<string, unknown>;
const branch = (v: unknown) => v && typeof v === "object" ? v as Branch : undefined;

function validate(schema: StandardSchema, data: unknown, where: string) {
  const res = schema["~standard"].validate(data);
  if (res.issues) throw new ValidationError(res.issues, where);
  return res.value;
}

function validatePart(schema: StandardSchema | undefined, src: Params, where: string, doCoerce: boolean) {
  if (!schema) return {};
  const shape = shapeOf(schema);
  const out: Params = Object.create(null);
  // strict: unknown fields are a caller mistake, not silently dropped
  if (schema.shape) for (const k of Object.keys(src)) if (!(k in shape)) throw new ValidationError([{ message: "unexpected field", path: [k] }], where);
  for (const [k, field] of Object.entries(shape)) if (k in src) out[k] = doCoerce ? coerce(src[k], field) : src[k];
  return validate(schema, out, where) as Params;
}

export const asParams = (v: unknown): Params => v && typeof v === "object" ? v as Params : {};

/** Out-of-band control channel, kept out of the input/query data namespace. */
export type InvokeOptions = { checkAccess?: boolean };

export async function invoke(tree: AptTree, method: string, path: string, rawParams: Params = {}, opts: InvokeOptions = {}): Promise<unknown> {
  const m = method.toLowerCase() as Method;
  if (!VERB_SET.has(m)) throw new NotFoundError(`no route: ${method} ${path}`);

  const segments: string[] = [];
  const nodes: AptNode[] = [];
  const pathValues: Record<string, unknown> = Object.create(null);

  let cursor: Branch = tree;
  const pathSegments = path.split("/").filter(Boolean).map(decodeSegment);
  for (let i = 0; i < pathSegments.length; i++) {
    const seg = pathSegments[i];
    const child = branch(cursor[seg]);
    if (child && !RESERVED.has(seg)) {
      cursor = child;
      segments.push(seg);
    } else {
      const keys = Object.keys(cursor);
      const paramKey = keys.find((k) => k.startsWith(":") && !isCatchall(k) && branch(cursor[k])) ??
        keys.find((k) => isCatchall(k) && branch(cursor[k]));
      if (!paramKey) throw new NotFoundError(`no route: ${method} ${path}`);
      pathValues[paramName(paramKey)] = isCatchall(paramKey) ? pathSegments.slice(i) : seg;
      cursor = branch(cursor[paramKey])!;
      segments.push(paramKey);
      nodes.push(cursor);
      if (isCatchall(paramKey)) break;
      continue;
    }
    nodes.push(cursor);
  }

  let verb = branch(cursor[m]) as Verb | undefined;
  if (!verb) {
    const paramKey = Object.keys(cursor).find((k) => isCatchall(k) && branch(cursor[k]));
    const child = paramKey ? branch(cursor[paramKey]) : undefined;
    if (paramKey && child) {
      pathValues[paramName(paramKey)] = [];
      cursor = child;
      segments.push(paramKey);
      nodes.push(cursor);
      verb = branch(cursor[m]) as Verb | undefined;
    }
  }
  if (!verb || typeof verb.execute !== "function") throw new NotFoundError(`no ${method} on ${path}`);

  const ctx = getCtx();
  const params: Params = Object.create(null);
  const isSplit = "input" in rawParams || "query" in rawParams;
  const input = isSplit ? asParams(rawParams.input) : rawParams;
  const query = isSplit ? asParams(rawParams.query) : rawParams;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg.startsWith(":")) continue;
    const name = paramName(seg);
    const node = nodes[i];
    let value: unknown = pathValues[name];
    if (isCatchall(seg) && node.paramSchema?.kind === "string" && Array.isArray(value)) value = value.join("/");
    if (node.paramSchema) value = validate(node.paramSchema, coerce(value, node.paramSchema), `param :${name}`);
    params[name] = node.resolve ? await node.resolve(value, ctx, params) : value;
  }

  if (!verb.access) throw new AccessError("no access defined");
  if (!await verb.access(ctx)) throw new AccessError();
  if (verb.guard && !await verb.guard(params, ctx)) throw new AccessError();
  if (opts.checkAccess) return { ok: true };

  Object.assign(params, validatePart(verb.input, input, "input", !BODY_METHODS.has(m)), validatePart(verb.query, query, "query", true));
  const result = await verb.execute(params, ctx);

  if (verb.output) {
    const res = verb.output["~standard"].validate(result);
    if (res.issues) console.warn(`[apt] output validation failed at ${m} ${path}:`, res.issues);
  }

  return result;
}

function decodeSegment(s: string) {
  try { return decodeURIComponent(s); } catch { return s; }
}

export function coerce(raw: unknown, schema: StandardSchema): unknown {
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
