import { Hono, type Context } from "../../../../deps.ts";
import { getCtx } from "../RequestContext.ts";
import { Req } from "../Req.ts";
import { Output } from "../util.ts";
import { AptError } from "./errors.ts";
import { invoke } from "./invoke.ts";
import { checkCollisions, walk } from "./route.ts";
import { BODY_METHODS, type AptTree, type Method, type Params } from "./types.ts";

type RequestData = { method: Method; path: string; input: Params; query: Params };

export type ToHonoAuth = (req: Req, data: RequestData) => boolean | Promise<boolean>;
export type ToHonoOptions = {
  csrf?: boolean;
  auth?: ToHonoAuth;
};

const MUTATION_METHODS = new Set(["post", "put", "patch", "delete"]);

/**
 * Run an apt request from a `Req`. Result is thrown as an `Output` signal (on both
 * success and error) so the host builds the `Response`. `path` is within the tree, e.g. `/user/5`.
 */
export async function aptFetch(req: Req, tree: AptTree, path: string, opts: ToHonoOptions = {}): Promise<never> {
  const input: Params = {};
  const query: Params = {};
  const method = req.method.toLowerCase() as Method;
  const isBodyMethod = BODY_METHODS.has(method);
  if (isBodyMethod) {
    if (!isJsonRequest(req)) throw new Output({ error: "Unsupported Media Type" }, { status: 415 });
    const body = await req.json().catch(() => ({}));
    if (body && typeof body === "object") Object.assign(input, body);
  }
  for (const [key, vals] of Object.entries(req.queries())) {
    query[key] = vals.length === 1 ? vals[0] : vals;
  }
  if (!isBodyMethod) Object.assign(input, query);
  try {
    await authorizeMutation(req, opts, { method, path, input, query });
    const result = await invoke(tree, req.method, path, { input, query });
    const body = result === undefined ? undefined : JSON.stringify(result);
    throw new Output(body, { status: result === undefined ? 204 : 200, headers: { "Content-Type": "application/json; charset=UTF-8" } });
  } catch (e) {
    if (e instanceof Output) throw e;
    if (e instanceof AptError)    throw new Output({ error: e.message, ...(e.issues && { issues: e.issues }) }, { status: e.status });
    console.error("[apt]", e);
    throw new Output({ error: e instanceof Error ? e.message : String(e) || "Internal Server Error" }, { status: 500 });
  }
}

/** Optional adapter: expose an apt tree as a mountable Hono app. */
export function toHono(tree: AptTree, app: Hono = new Hono(), opts: ToHonoOptions = {}): Hono {
  for (const r of walk(tree)) checkCollisions(r);
  const handle = (c: Context): Promise<never> => aptFetch(new Req(c.req.raw), tree, "/" + (c.req.param("path") ?? ""), opts);
  app.all("/", handle);
  app.all("/:path{.*}", handle);
  return app;
}

function isJsonRequest(req: Req): boolean {
  const type = req.header("content-type")?.split(";")[0].trim().toLowerCase();
  return !type || type === "application/json" || type.endsWith("+json");
}

async function authorizeMutation(req: Req, opts: ToHonoOptions, data: RequestData): Promise<void> {
  if (!MUTATION_METHODS.has(data.method)) return;
  if (opts.auth && await opts.auth(req, data)) return;
  if (opts.csrf === false) return;
  if (!isTrustedOrigin(req)) throw new Output({ error: "Forbidden" }, { status: 403 });
  if (!hasValidCsrfToken(req)) throw new Output({ error: "Forbidden" }, { status: 403 });
}

function isTrustedOrigin(req: Req): boolean {
  const target = new URL(req.url).origin;
  const origin = originOf(req.header("origin"));
  if (origin) return origin === target;
  const referer = req.header("referer");
  if (!referer) return false;
  return originOf(referer) === target;
}

function originOf(value?: string): string | null {
  if (!value) return null;
  try { return new URL(value).origin; }
  catch { return null; }
}

function hasValidCsrfToken(req: Req): boolean {
  const token = req.header("x-csrf-token");
  return typeof token === "string" && token !== "" && token === getCtx().token;
}
