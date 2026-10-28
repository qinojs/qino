import { Hono, basePath } from "../deps.ts";

import type { App } from "./App.ts";

/**
 * Optional adapter: mount a Qino app under a prefix in Hono, e.g.
 * `hono.route("/cms1", honoAdapter(app))`. Hono only strips the prefix; `app.handle` does the routing.
 */
export function honoAdapter(app: App): Hono {
  const hono = new Hono();
  // c.env is the server's second handler argument: the info of `sys.serve` (and `Deno.serve`)
  hono.all("*", (c) => {
    const info = c.env as { remoteAddr?: { hostname?: string } } | undefined;
    return app.handle(c.req.raw, basePath(c), info?.remoteAddr?.hostname ?? "");
  });
  return hono;
}
