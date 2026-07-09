import dbSchema from "./dbschema.json" with { type: "json" };
import { Output, type App } from "../core/mod.ts";
import { verifyToken } from "./lib/keys.ts";

export const name = "api_key";
export const needs = ["core"];
export { api } from "./apt.ts";
export { dbSchema };

export function init(app: App): void {
  app.on("authenticate", async ({ ctx }) => {
    // only the own naming scheme (qk_…) is claimed; foreign Bearer formats fall through
    const m = /^Bearer\s+(qk_[A-Za-z0-9_-]+)$/i.exec(ctx.req.header("authorization")?.trim() ?? "");
    if (!m) return;
    const key = await verifyToken(app, m[1]);
    if (!key) throw new Output({ error: "invalid api key" }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } }); // loud, no anonymous fallback
    ctx.authenticate(key.usrId);
  });
}
