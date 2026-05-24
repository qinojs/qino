import { Hono, type Context } from "../../../../deps.ts";
import { getCtx } from "../RequestContext.ts";
import { AnswerError } from "../util.ts";
import { AptError } from "./errors.ts";
import { invoke } from "./invoke.ts";
import { checkCollisions, walk } from "./route.ts";
import { BODY_METHODS, type AptTree, type Method, type Params } from "./types.ts";

export type ToHonoAuth = (c: Context, data: { method: string; path: string; input: Params; query: Params }) => boolean | Promise<boolean>;
export type ToHonoOptions = {
  csrf?: boolean;
  trustedOrigins?: string[];
  auth?: ToHonoAuth;
};

const MUTATION_METHODS = new Set(["post", "put", "patch", "delete"]);

export function toHono(tree: AptTree, app: Hono = new Hono(), opts: ToHonoOptions = {}): Hono {
  for (const r of walk(tree)) checkCollisions(r);
  const handle = async (c: Context): Promise<Response> => {
    const path = "/" + (c.req.param("path") ?? "");
    const input: Params = {};
    const query: Params = {};
    const method = c.req.method.toLowerCase() as Method;
    const isBodyMethod = BODY_METHODS.has(method);
    if (isBodyMethod) {
      if (!isJsonRequest(c)) throw new AnswerError({ error: "Unsupported Media Type" }, 415);
      const body = await c.req.json().catch(() => ({}));
      if (body && typeof body === "object") Object.assign(input, body);
    }
    for (const key of new Set(Object.keys(c.req.queries()))) {
      const vals = c.req.queries(key) ?? [];
      query[key] = vals.length === 1 ? vals[0] : vals;
    }
    if (!isBodyMethod) Object.assign(input, query);
    try {
      await authorizeMutation(c, opts, { method, path, input, query });
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

function isJsonRequest(c: Context): boolean {
  const type = c.req.header("content-type")?.split(";")[0].trim().toLowerCase();
  return !type || type === "application/json" || type.endsWith("+json");
}

async function authorizeMutation(c: Context, opts: ToHonoOptions, data: { method: Method; path: string; input: Params; query: Params }): Promise<void> {
  if (!MUTATION_METHODS.has(data.method)) return;
  if (opts.auth && await opts.auth(c, data)) return;
  if (opts.csrf === false) return;
  if (!isTrustedOrigin(c, opts)) throw new AnswerError({ error: "Forbidden" }, 403);
  if (!hasValidCsrfToken(c)) throw new AnswerError({ error: "Forbidden" }, 403);
}

function isTrustedOrigin(c: Context, opts: ToHonoOptions): boolean {
  const target = new URL(c.req.url).origin;
  const allowed = new Set([target, ...(opts.trustedOrigins ?? []).map(originOf).filter((v): v is string => !!v)]);
  const origin = originOf(c.req.header("origin"));
  if (origin) return allowed.has(origin);
  const referer = c.req.header("referer");
  if (!referer) return false;
  return allowed.has(originOf(referer) ?? "");
}

function originOf(value?: string): string | null {
  if (!value) return null;
  try { return new URL(value).origin; }
  catch { return null; }
}

function hasValidCsrfToken(c: Context): boolean {
  const token = c.req.header("x-csrf-token");
  return typeof token === "string" && token !== "" && token === getCtx().token;
}
