import { Hono, basePath, getConnInfo } from "../deps.ts";
import type { App } from "./App.ts";

/**
 * Optional adapter: mount a Qino app under a path prefix in Hono, e.g.
 * `hono.route("/cms1", honoAdapter(app))`. Hono only strips the prefix; routing lives in `app.handle`.
 */
export function honoAdapter(app: App): Hono {
  const hono = new Hono();
  hono.all("*", (c) => app.handle(c.req.raw, basePath(c), getConnInfo(c).remote.address ?? ""));
  return hono;
}
