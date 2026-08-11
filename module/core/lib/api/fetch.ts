import { getCtx, requestStorage } from "../ctx/Ctx.ts";
import type { Req } from "../ctx/Req.ts";
import { Output } from "../util.ts";
import { ApiError } from "./errors.ts";
import { invoke } from "./invoke.ts";
import { BODY_METHODS, type ApiTree, type Method, type Params } from "./types.ts";
import { errMsg } from "../util.ts";

type RequestData = { method: Method; path: string; input: Params; query: Params };

export type ApiFetchAuth = (req: Req, data: RequestData) => boolean | Promise<boolean>;
export type ApiFetchOptions = {
  csrf?: boolean;
  auth?: ApiFetchAuth;
};

const MUTATION_METHODS = new Set(["post", "put", "patch", "delete"]);

/**
 * Run an api request from a `Req`. Result is thrown as an `Output` signal (on both
 * success and error) so the host builds the `Response`. `path` is within the tree, e.g. `/user/5`.
 */
export async function apiFetch(req: Req, tree: ApiTree, path: string, opts: ApiFetchOptions = {}): Promise<never> {
  const input = Object.create(null);
  const query = Object.create(null);
  const method = req.method.toLowerCase() as Method;
  const isBodyMethod = BODY_METHODS.has(method);
  if (isBodyMethod) {
    if (!isJsonRequest(req)) throw new Output({ error: "Unsupported Media Type" }, { status: 415 });
    const body = req.body; // parsed once in Req.create; invalid JSON already answered with 400
    if (body && typeof body === "object") Object.assign(input, body);
  }
  for (const [k, v] of Object.entries(req.queryAll)) query[k] = v.length === 1 ? v[0] : [...v];
  if (!isBodyMethod) Object.assign(input, query);
  try {
    await authorizeMutation(req, opts, { method, path, input, query });
    const checkAccess = req.header("x-api-check") === "access"; // dry-run: run the access/guard gate, skip execute
    const result = await invoke(tree, req.method, path, { input, query }, { checkAccess });
    const body = result === undefined ? undefined : JSON.stringify(result);
    throw new Output(body, { status: result === undefined ? 204 : 200, headers: { "Content-Type": "application/json; charset=UTF-8" } });
  } catch (e) {
    if (e instanceof Output) throw e;
    if (e instanceof ApiError) throw new Output({ error: e.message, ...(e.issues && { issues: e.issues }) }, { status: e.status });
    console.error("[api]", e);
    // unknown errors: detail only in dev, generic message otherwise (may contain SQL/paths)
    const detail = requestStorage.getStore()?.app.dev ? (errMsg(e)) : "";
    throw new Output({ error: detail || "Internal Server Error" }, { status: 500 });
  }
}

function isJsonRequest(req: Req): boolean {
  const type = req.header("content-type")?.split(";")[0].trim().toLowerCase();
  return !type || type === "application/json" || type.endsWith("+json");
}

async function authorizeMutation(req: Req, opts: ApiFetchOptions, data: RequestData): Promise<void> {
  if (!MUTATION_METHODS.has(data.method)) return;
  if (opts.auth && await opts.auth(req, data)) return;
  if (opts.csrf === false) return;
  if (!isTrustedOrigin(req) || !hasValidCsrfToken(req)) throw new Output({ error: "Forbidden" }, { status: 403 });
}

// Match host:port, not scheme — behind a TLS-terminating proxy the app sees http while the browser sends an https Origin.
export function isTrustedOrigin(req: Req): boolean {
  const target = req.url.host;
  const origin = hostOf(req.header("origin"));
  if (origin) return origin === target;
  const referer = req.header("referer");
  if (!referer) return false;
  return hostOf(referer) === target;
}

function hostOf(value?: string): string | null {
  try { return value ? new URL(value).host : null; }
  catch { return null; }
}

function hasValidCsrfToken(req: Req): boolean {
  const token = req.header("x-csrf-token");
  return typeof token === "string" && token !== "" && token === getCtx().csrfToken;
}
