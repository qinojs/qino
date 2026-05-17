import { Hono, type Context } from "../../../../deps.ts";
import { AnswerError } from "../util.ts";
import { AptError } from "./errors.ts";
import { invoke } from "./invoke.ts";
import { checkCollisions, walk } from "./route.ts";
import { BODY_METHODS, type AptTree, type Method, type Params } from "./types.ts";

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
