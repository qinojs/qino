/**
 * init.ts - Session and logging initialization
 * Port of core/lib/init.php (liveClient, liveSess, liveLog classes)
 */

import { createHash } from "node:crypto";
import type { RequestContext } from "./RequestContext.ts";
import { uid } from "./util.ts";

export async function initClient(ctx: RequestContext): Promise<void> {
    const db = ctx.app.db;
    if (ctx.clientId) return;

    const cid = ctx.cookie[ctx.app.https ? "__Host-cid" : "cid"];
    if (!cid) {
      await registerClient(ctx);
      return;
    }
    const clientId = await db.one("SELECT id FROM client WHERE hash = ?", [cid]);
    if (!clientId) {
      await registerClient(ctx);
      return;
    }
    ctx.clientId = String(clientId);
}


async function registerClient(ctx: RequestContext): Promise<void> {
    const hash = uid();

    const cidName = ctx.app.https ? "__Host-cid" : "cid";
    const cookieOpts = [
      `${cidName}=${hash}`,
      "Path=/",
      "Expires=Sat, 01 Jan 2033 00:00:00 GMT",
      "HttpOnly",
      "SameSite=Lax",
      ctx.app.https ? "Secure" : "",
    ].filter(Boolean).join("; ");
    ctx.responseHeaders.append("Set-Cookie", cookieOpts);
    ctx.cookie[cidName] = hash;

    const clientId = await ctx.app.db.table("client").insert({ hash });
    ctx.clientId = String(clientId);
};

export function touchSession(ctx: RequestContext): void {
    if (ctx.sessId) ctx.app.sessions.touch(ctx.sessId, ctx.userId);
};

export async function initLog(ctx: RequestContext): Promise<void> {
    
    const db = ctx.app.db;

    const data: Record<string, unknown> = {
      time: Math.floor(Date.now() / 1000),
      sess_id: ctx.sessId,
    };

    let post = Object.keys(ctx.post).length ? JSON.stringify(ctx.post) : "";
    if (post && post.includes("pw")) {
      post = post.replace(/"pw":"[^"]*/, '"pw":"-----');
      post = post.replace(/pw\\":{\\"[^\\]*/, 'pw\\":\\"-----');
    }
    data.post = post;
    data.client_id     = ctx.clientId;

    const logId = await db.table("log").insert(data);
    ctx.logId = String(logId);
    data.log_id = logId;


    setTimeout(async ()=>{ // background
      try {
        const url = ctx.requestUri;
        const urlHash = createHash("md5").update(url).digest("hex");
        let urlId = await db.one("SELECT id FROM log_url WHERE hash = ?", [urlHash]);
        if (!urlId) urlId = await db.table("log_url").insert({ url, hash: urlHash });

        const referer = ctx.req.header("referer") || "";
        const refererHash = createHash("md5").update(referer).digest("hex");
        let refererId = await db.one("SELECT id FROM log_url WHERE hash = ?", [refererHash]);
        if (!refererId) refererId = await db.table("log_url").insert({ url: referer, hash: refererHash });

        const ip = ctx.remoteAddr || "";
        let ipId = await db.one("SELECT id FROM log_ip WHERE ip = ?", [ip]);
        if (!ipId) ipId = await db.table("log_ip").insert({ ip });

        const ua = ctx.req.header("user-agent") || "";
        let uaId = await db.one("SELECT id FROM log_user_agent WHERE user_agent = ?", [ua]);
        if (!uaId) uaId = await db.table("log_user_agent").insert({ user_agent: ua });


        data.url_id        = urlId;
        data.referer_id    = refererId;
        data.ip_id         = ipId;
        data.user_agent_id = uaId;
        await db.table("log").update(data);

      } catch (e) { console.error("liveLog background error:", e); }
    },100)

};
