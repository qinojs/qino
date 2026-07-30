import dbSchema from "./dbschema.json" with { type: "json" };
import { Output, type App } from "../core/mod.ts";
import { authorize, metadata, register, resourceMetadata, token } from "./mod.ts";
import { verify } from "./lib/tokens.ts";

export const name = "oauth_server";
export const needs = ["core"];
export { api } from "./apt.ts";
export { dbSchema };

export const settingsSchema = {
  properties: {
    accessTokenTtl: { type: "integer", minimum: 60, default: 3600, description: "Lifetime of an issued access token, in seconds." },
    refreshTokenTtl: { type: "integer", minimum: 60, default: 2592000, description: "Lifetime of an issued refresh token, in seconds. Every use rotates it." },
    dynamicRegistration: { type: "boolean", default: true, description: "Let clients register themselves (RFC 7591). Off: clients must be created by a superuser." },
  },
};

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.on("route", async ({ ctx }) => {
    const path = ctx.req.appPath;
    if (path === "authorize") await authorize(ctx);
    else if (path === "token") await token(ctx);
    else if (path === "register") await register(ctx);
    // the resource path may be appended to the well-known name (MCP clients probe both forms)
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
