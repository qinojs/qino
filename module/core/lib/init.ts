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

    const https = ctx.app.https;
    const cidName = https ? "__Host-cid" : "cid";
    const parts = [`${cidName}=${hash}`, `Path=${ctx.appURL}`, "Expires=Sat, 01 Jan 2033 00:00:00 GMT", "HttpOnly;SameSite=Lax"];
    if (https) parts.push("Secure");
    ctx.responseHeaders.append("Set-Cookie", parts.join("; "));
    ctx.cookie[cidName] = hash;

    const clientId = await ctx.app.db.table("client").insert({ hash });
    ctx.clientId = String(clientId);
};

export function touchSession(ctx: RequestContext): void {
    if (ctx.sessId) ctx.app.sessions.touch(ctx.sessId, ctx.userId);
};

export function initLog(ctx: RequestContext): void {

    const db = ctx.app.db;

    const data: Record<string, unknown> = {
      time: Math.floor(Date.now() / 1000),
      sess_id: ctx.sessId,
    };

    // redact secrets by key name
    const secret = /pw|oldpw|token/i;
    data.post = Object.keys(ctx.post).length
      ? JSON.stringify(ctx.post, (k, v) => k && secret.test(k) ? "-----" : v)
      : "";
    data.client_id     = ctx.clientId;

    // insert runs in the background; consumers await ctx.logId only when they actually need the id
    ctx.logId = (async () => {
      try {
        const logId = await db.table("log").insert(data);
        data.log_id = logId;
        return logId === false ? null : String(logId);
      } catch (e) { console.error("initLog insert error:", e); return null; }
    })();

    setTimeout(async ()=>{ // background
      await ctx.logId; // ensure the insert finished so data.id exists for the update below
      try {
        const url = ctx.requestUri;
        const urlHash = createHash("md5").update(url).digest("hex");
        let urlId = await db.one("SELECT id FROM log_url WHERE hash = ?", [urlHash]);
        urlId ||= await db.table("log_url").insert({ url, hash: urlHash });

        const referer = ctx.req.header("referer") ?? "";
        const refererHash = createHash("md5").update(referer).digest("hex");
        let refererId = await db.one("SELECT id FROM log_url WHERE hash = ?", [refererHash]);
        refererId ||= await db.table("log_url").insert({ url: referer, hash: refererHash });

        const ip = ctx.remoteAddr ?? "";
        let ipId = await db.one("SELECT id FROM log_ip WHERE ip = ?", [ip]);
        ipId ||= await db.table("log_ip").insert({ ip });

        const ua = ctx.req.header("user-agent") ?? "";
        let uaId = await db.one("SELECT id FROM log_user_agent WHERE user_agent = ?", [ua]);
        uaId ||= await db.table("log_user_agent").insert({ user_agent: ua });

        data.url_id        = urlId;
        data.referer_id    = refererId;
        data.ip_id         = ipId;
        data.user_agent_id = uaId;
        await db.table("log").update(data);

      } catch (e) { console.error("liveLog background error:", e); }
    },100)

};
