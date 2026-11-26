import { Output } from "@qino/qino";

import { verifyToken } from "./lib/keys.ts";

import type { App } from "@qino/qino";

export { api } from "./api.ts";
export { default as dbSchema } from "./dbschema.json" with { type: "json" };

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.on("authenticate", ({ ctx }) => {
    // only the own naming scheme (qk_…) is claimed; foreign Bearer formats fall through
    const m = /^Bearer\s+(qk_[\w-]+)$/i.exec(ctx.req.header("authorization")?.trim() ?? "");
    if (!m) return;
    return verifyToken(app, m[1]).then((key) => {
      if (!key) throw new Output({ error: "invalid api key" }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } }); // loud, no anonymous fallback
      return ctx.authenticate(key.usrId, "api_key:" + key.id);
    });
  }, { signal });
}
