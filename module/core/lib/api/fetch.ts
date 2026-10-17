import { getCtx, requestStorage } from "../ctx/Ctx.ts";
import { safeEqual } from "../crypto.ts";
import { errMsg, Output } from "../util.ts";
import { ApiError } from "./errors.ts";
import { invoke } from "./invoke.ts";
import { BODY_METHODS } from "./types.ts";

import type { Req } from "../ctx/Req.ts";
import type { ApiTree, Method, Params } from "./types.ts";

type RequestData = { method: Method; path: string; input: Params; query: Params };

export type ApiFetchAuth = (req: Req, data: RequestData) => boolean | Promise<boolean>;
export type ApiFetchOptions = {
  csrf?: boolean;
  auth?: ApiFetchAuth;
};

const MUTATION_METHODS = new Set(["post", "put", "patch", "delete"]);

/**
 * Run an api request. The result is thrown as `Output` (success and error) and the host builds the
 * `Response`. `path` is within the tree, e.g. `/user/5`.
 */
export async function apiFetch(req: Req, tree: ApiTree, path: string, opts: ApiFetchOptions = {}): Promise<never> {
  const input = Object.create(null);
  const query = Object.create(null);
  const method = req.method.toLowerCase() as Method;
  const isBodyMethod = BODY_METHODS.has(method);
  if (isBodyMethod) {
    if (!isJsonRequest(req)) throw new Output({ error: "Unsupported Media Type" }, { status: 415 });
    const body = req.body; // parsed in Req.create; invalid JSON already got 400
    if (body && typeof body === "object") Object.assign(input, body);
  }
  for (const [k, v] of Object.entries(req.queryAll)) query[k] = v.length === 1 ? v[0] : [...v];
  if (!isBodyMethod) Object.assign(input, query);
  try {
    await authorizeMutation(req, opts, { method, path, input, query });
    const checkAccess = req.header("x-api-check") === "access"; // dry run: check access/guard, skip execute
    const result = await invoke(tree, req.method, path, { input, query }, { checkAccess });
    const body = result === undefined ? undefined : JSON.stringify(result);
    throw new Output(body, { status: result === undefined ? 204 : 200, headers: { "Content-Type": "application/json; charset=UTF-8" } });
  } catch (e) {
    if (e instanceof Output) throw e;
    if (e instanceof ApiError) throw new Output({ error: e.message, ...(e.code && { code: e.code }), ...(e.data !== undefined && { data: e.data }) }, { status: e.status });
    console.error("[api]", e);
    // unknown errors: detail only in dev, generic message otherwise (may contain SQL/paths)
    const detail = requestStorage.getStore()?.app.dev ? errMsg(e) : "";
    throw new Output({ error: detail || "Internal Server Error" }, { status: 500 });
  }
}

function isJsonRequest(req: Req) {
  const type = req.header("content-type")?.split(";")[0].trim().toLowerCase();
  return !type || type === "application/json" || type.endsWith("+json");
}

async function authorizeMutation(req: Req, opts: ApiFetchOptions, data: RequestData) {
  if (!MUTATION_METHODS.has(data.method)) return;
  if (opts.auth && await opts.auth(req, data)) return;
  if (opts.csrf === false) return;
  if (!isTrustedOrigin(req) || !hasValidCsrfToken(req)) throw new Output({ error: "Forbidden" }, { status: 403 });
}

// Compare host:port, not scheme — behind a TLS proxy the app sees http, the Origin says https.
export function isTrustedOrigin(req: Req): boolean {
  const target = req.url.host;
  return (hostOf(req.header("origin")) || hostOf(req.header("referer"))) === target;
}

function hostOf(value?: string) {
  return value ? URL.parse(value)?.host ?? null : null;
}

function hasValidCsrfToken(req: Req) {
  return safeEqual(req.header("x-csrf-token"), getCtx().csrfToken);
}
