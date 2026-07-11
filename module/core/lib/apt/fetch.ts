import { getCtx, requestStorage } from "../ctx/RequestContext.ts";
import type { ContextRequest } from "../ctx/ContextRequest.ts";
import { Output } from "../util.ts";
import { AptError } from "./errors.ts";
import { invoke } from "./invoke.ts";
import { BODY_METHODS, type AptTree, type Method, type Params } from "./types.ts";

type RequestData = { method: Method; path: string; input: Params; query: Params };

export type AptFetchAuth = (req: ContextRequest, data: RequestData) => boolean | Promise<boolean>;
export type AptFetchOptions = {
  csrf?: boolean;
  auth?: AptFetchAuth;
};

const MUTATION_METHODS = new Set(["post", "put", "patch", "delete"]);

/**
 * Run an apt request from a `ContextRequest`. Result is thrown as an `Output` signal (on both
 * success and error) so the host builds the `Response`. `path` is within the tree, e.g. `/user/5`.
 */
export async function aptFetch(req: ContextRequest, tree: AptTree, path: string, opts: AptFetchOptions = {}): Promise<never> {
  const input: Params = Object.create(null);
  const query: Params = Object.create(null);
  const method = req.method.toLowerCase() as Method;
  const isBodyMethod = BODY_METHODS.has(method);
  if (isBodyMethod) {
    if (!isJsonRequest(req)) throw new Output({ error: "Unsupported Media Type" }, { status: 415 });
    const body = req.body; // parsed once in ContextRequest.create; invalid JSON already answered with 400
    if (body && typeof body === "object") Object.assign(input, body);
  }
  for (const [k, v] of Object.entries(req.queryAll)) {
    query[k] = v.length === 1 ? v[0] : [...v];
  }
  if (!isBodyMethod) Object.assign(input, query);
  try {
    await authorizeMutation(req, opts, { method, path, input, query });
    const result = await invoke(tree, req.method, path, { input, query });
    const body = result === undefined ? undefined : JSON.stringify(result);
    throw new Output(body, { status: result === undefined ? 204 : 200, headers: { "Content-Type": "application/json; charset=UTF-8" } });
  } catch (e) {
    if (e instanceof Output) throw e;
    if (e instanceof AptError) throw new Output({ error: e.message, ...(e.issues && { issues: e.issues }) }, { status: e.status });
    console.error("[apt]", e);
    // unknown errors: detail only in dev, generic message otherwise (may contain SQL/paths)
    const detail = requestStorage.getStore()?.app.dev ? (e instanceof Error ? e.message : String(e)) : "";
    throw new Output({ error: detail || "Internal Server Error" }, { status: 500 });
  }
}

function isJsonRequest(req: ContextRequest): boolean {
  const type = req.header("content-type")?.split(";")[0].trim().toLowerCase();
  return !type || type === "application/json" || type.endsWith("+json");
}

async function authorizeMutation(req: ContextRequest, opts: AptFetchOptions, data: RequestData): Promise<void> {
  if (!MUTATION_METHODS.has(data.method)) return;
  if (opts.auth && await opts.auth(req, data)) return;
  if (opts.csrf === false) return;
  if (!isTrustedOrigin(req)) throw new Output({ error: "Forbidden" }, { status: 403 });
  if (!hasValidCsrfToken(req)) throw new Output({ error: "Forbidden" }, { status: 403 });
}

// Match host:port, not scheme — behind a TLS-terminating proxy the app sees http while the browser sends an https Origin.
function isTrustedOrigin(req: ContextRequest): boolean {
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

function hasValidCsrfToken(req: ContextRequest): boolean {
  const token = req.header("x-csrf-token");
  return typeof token === "string" && token !== "" && token === getCtx().csrfToken;
}
