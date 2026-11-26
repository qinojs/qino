import { Output } from "@qino/qino";

import { authorize, metadata, register, resourceMetadata, token } from "./mod.ts";
import { verify } from "./lib/tokens.ts";

import type { App } from "@qino/qino";

export { api } from "./api.ts";
export { default as dbSchema } from "./dbschema.json" with { type: "json" };

export const settingsSchema = {
  properties: {
    dynamicRegistration: { type: "boolean", default: true, description: "Let clients register themselves (RFC 7591). Off: clients must be created by a superuser." },
  },
};

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.on("route", ({ ctx }) => {
    const path = ctx.req.appPath;
    if (path === "authorize") return authorize(ctx);
    if (path === "token") return token(ctx);
    if (path === "register") return register(ctx);
    // the resource path may be appended to the well-known name (RFC 9728 §3.1)
    if (path.startsWith(".well-known/oauth-authorization-server")) return metadata(ctx).then((m) => { throw new Output(m); });
    if (path.startsWith(".well-known/oauth-protected-resource")) throw new Output(resourceMetadata(ctx));
  }, { signal });

  app.on("authenticate", ({ ctx }) => {
    const m = /^Bearer\s+(qo_[\w-]+)$/i.exec(ctx.req.header("authorization")?.trim() ?? "");
    if (!m) return; // only the own naming scheme is claimed; foreign Bearer formats fall through
    return verify(app, "access", m[1]).then((row) => {
      if (!row) throw new Output({ error: "invalid_token" }, { status: 401, headers: { "WWW-Authenticate": `Bearer error="invalid_token"` } });
      return ctx.authenticate(Number(row.usr_id), "oauth_client:" + row.client_id);
    });
  }, { signal });
}
