import dbSchema from "./dbschema.json" with { type: "json" };
import { Output, type App } from "../core/mod.ts";
import { authorize, metadata, register, resourceMetadata, token } from "./mod.ts";
import { verify } from "./lib/tokens.ts";

export const name = "oauth_server";
export const description = "Provides an OAuth authorization server with bearer token authentication.";
export const needs = ["core"];
export { api } from "./apt.ts";
export { dbSchema };

export const settingsSchema = {
  properties: {
    dynamicRegistration: { type: "boolean", default: true, description: "Let clients register themselves (RFC 7591). Off: clients must be created by a superuser." },
  },
};

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.on("route", async ({ ctx }) => {
    const path = ctx.req.appPath;
    if (path === "authorize") await authorize(ctx);
    else if (path === "token") await token(ctx);
    else if (path === "register") await register(ctx);
    // the resource path may be appended to the well-known name (RFC 9728 §3.1)
    else if (path.startsWith(".well-known/oauth-authorization-server")) throw new Output(await metadata(ctx));
    else if (path.startsWith(".well-known/oauth-protected-resource")) throw new Output(resourceMetadata(ctx));
  }, { signal });

  app.on("authenticate", async ({ ctx }) => {
    const m = /^Bearer\s+(qo_[A-Za-z0-9_-]+)$/i.exec(ctx.req.header("authorization")?.trim() ?? "");
    if (!m) return; // only the own naming scheme is claimed; foreign Bearer formats fall through
    const row = await verify(app, "access", m[1]);
    if (!row) throw new Output({ error: "invalid_token" }, { status: 401, headers: { "WWW-Authenticate": `Bearer error="invalid_token"` } });
    ctx.authenticate(Number(row.usr_id));
  }, { signal });
}
