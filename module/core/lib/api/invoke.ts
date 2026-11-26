import { requireStepUp } from "../auth/factors.ts";
import { getCtx } from "../ctx/Ctx.ts";
import { AccessError, NotFoundError, ValidationError } from "./errors.ts";
import { BODY_METHODS, RESERVED, VERB_SET, branch } from "./types.ts";
import { isCatchall, paramName, shapeOf } from "./route.ts";

import type { StandardSchema } from "../StandardSchema.ts";
import type { ApiNode, ApiTree, Branch, Method, Params, Verb } from "./types.ts";

function validate(schema: StandardSchema, data: unknown, where: string) {
  const res = schema["~standard"].validate(data);
  if (res.issues) throw new ValidationError(res.issues, where);
  return res.value;
}

function validatePart(schema: StandardSchema | undefined, src: Params, where: string, doCoerce: boolean) {
  if (!schema) return {};
  const shape = shapeOf(schema);
  const out: Params = Object.create(null);
  // strict: unknown fields throw instead of being dropped
  if (schema.shape) for (const k of Object.keys(src)) if (!(k in shape)) throw new ValidationError([{ message: "unexpected field", path: [k] }], where);
  for (const [k, field] of Object.entries(shape)) if (k in src) out[k] = doCoerce ? coerce(src[k], field) : src[k];
  return validate(schema, out, where) as Params;
}

export const asParams = (v: unknown): Params => v && typeof v === "object" ? v as Params : {};

/** Control options, separate from input and query data. */
export type InvokeOptions = { checkAccess?: boolean };

export async function invoke(tree: ApiTree, method: string, path: string, rawParams: Params = {}, opts: InvokeOptions = {}): Promise<unknown> {
  const m = method.toLowerCase() as Method;
  if (!VERB_SET.has(m)) throw new NotFoundError(`no route: ${method} ${path}`);

  const pathNodes: [string, ApiNode][] = [];
  const pathValues: Record<string, unknown> = Object.create(null);

  let cursor: Branch = tree;
  const pathSegments = path.split("/").filter(Boolean).map(decodeSegment);
  for (let i = 0; i < pathSegments.length; i++) {
    const seg = pathSegments[i];
    const child = branch(cursor[seg]);
    if (child && !RESERVED.has(seg)) {
      cursor = child;
      // A URL can name a parameter key literally; that node still needs validation.
      if (seg.startsWith(":")) pathNodes.push([seg, child]);
      continue;
    }
    const keys = Object.keys(cursor);
    const paramKey = keys.find((k) => k.startsWith(":") && !isCatchall(k) && branch(cursor[k])) ??
      keys.find((k) => isCatchall(k) && branch(cursor[k]));
    if (!paramKey) throw new NotFoundError(`no route: ${method} ${path}`);
    const catchall = isCatchall(paramKey);
    pathValues[paramName(paramKey)] = catchall ? pathSegments.slice(i) : seg;
    cursor = branch(cursor[paramKey])!;
    pathNodes.push([paramKey, cursor]);
    if (catchall) break;
  }

  let verb = branch(cursor[m]) as Verb | undefined;
  if (!verb) {
    const paramKey = Object.keys(cursor).find((k) => isCatchall(k) && branch(cursor[k]));
    if (paramKey) {
      const child = branch(cursor[paramKey])!;
      pathValues[paramName(paramKey)] = [];
      pathNodes.push([paramKey, child]);
      verb = branch(child[m]) as Verb | undefined;
    }
  }
  if (!verb || typeof verb.execute !== "function") throw new NotFoundError(`no ${method} on ${path}`);

  const ctx = getCtx();
  if (!verb.access) throw new AccessError("no access defined");
  if (!await verb.access(ctx)) throw new AccessError();
  const params: Params = Object.create(null);
  const isSplit = "input" in rawParams || "query" in rawParams;
  const input = isSplit ? asParams(rawParams.input) : rawParams;
  const query = isSplit ? asParams(rawParams.query) : rawParams;

  for (const [seg, node] of pathNodes) {
    const name = paramName(seg);
    let value: unknown = pathValues[name];
    if (isCatchall(seg) && node.paramSchema?.kind === "string" && Array.isArray(value)) value = value.join("/");
    if (node.paramSchema) value = validate(node.paramSchema, coerce(value, node.paramSchema), `param :${name}`);
    params[name] = node.resolve ? await node.resolve(value, ctx, params) : value;
  }

  // a dry run has no input, so the guard only sees the path params
  if (!opts.checkAccess) Object.assign(params, validatePart(verb.input, input, "input", !BODY_METHODS.has(m)), validatePart(verb.query, query, "query", true));
  if (verb.guard && !await verb.guard(params, ctx)) throw new AccessError();
  // a dry run only checks access; the proof can still be given later
  if (opts.checkAccess) return { ok: true };
  if (verb.requireStepUp) await requireStepUp(ctx, verb.requireStepUp === true ? {} : verb.requireStepUp);

  const result = await verb.execute(params, ctx);

  if (verb.output) {
    const res = verb.output["~standard"].validate(result);
    if (res.issues) console.warn(`[api] output validation failed at ${m} ${path}:`, res.issues);
  }

  return result;
}

function decodeSegment(s: string) {
  try { return s.includes("%") ? decodeURIComponent(s) : s; } catch { return s; }
}

export function coerce(raw: unknown, schema: StandardSchema): unknown {
  if (raw == null) return raw;
  if (schema.kind === "optional" && schema.inner) schema = schema.inner;
  const { kind, inner } = schema;
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
