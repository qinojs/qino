import { createHash } from "node:crypto";
import type { Ctx } from "./Ctx.ts";
import { header, cookiePrefix, uid, unixTime } from "../util.ts";
import { authListen } from "../auth.ts";

/** Per-request boot: client cookie, auth, session, settings, language, access log. */
export async function initRequest(ctx: Ctx): Promise<void> {
    await ctx.app.fire("authenticate", { ctx }); // explicit credentials first: a Bearer beats an ambient cookie
    if (!ctx.statelessAuth) {
        await initClient(ctx);
        await authListen(ctx);
        touchSession(ctx);
    }
    await ctx.initSettings();
    await ctx.app.languages.initCtx(ctx);
    initLog(ctx);
}

async function initClient(ctx: Ctx): Promise<void> {
    const db = ctx.app.db;
    if (ctx.clientId) return;

    const cid = ctx.req.cookies[cookiePrefix(ctx.app.https, ctx.req.appUrl) + "cid"];
    if (!cid) {
      await registerClient(ctx);
      return;
    }
    const clientId = await db.one`SELECT id FROM client WHERE hash = ${cid}`;
    if (!clientId) {
      await registerClient(ctx);
      return;
    }
    ctx.clientId = String(clientId);
}

async function registerClient(ctx: Ctx): Promise<void> {
    const hash = uid();
    ctx.res.headers.append(...header.setCookie("cid", hash, ctx.req.appUrl, ctx.app.https, 5 * 365 * 24 * 60 * 60));
    const clientId = await ctx.app.db.table("client").insert({ hash });
    ctx.clientId = String(clientId);
}

function touchSession(ctx: Ctx): void {
    if (ctx.sess) ctx.sess.touch(ctx.userId);
}

function initLog(ctx: Ctx): void {

    const db = ctx.app.db;

    const data: Record<string, unknown> = {
      time: unixTime(),
      sess_id: ctx.sess?.id,
    };

    // redact secrets by key name, clip long values — a single field (data: URI, base64) must not overflow the row
    const secret = /pw|pass|token|secret|key|auth/i;
    const clip = (s: string, max: number) => s.length > max ? `${s.slice(0, max)}…(${s.length})` : s;
    data.post = ctx.req.body != null
      ? clip(JSON.stringify(ctx.req.body, (k, v) => k && secret.test(k) ? "-----" : typeof v === "string" ? clip(v, 1000) : v), 10000)
      : "";
    data.client_id = ctx.clientId;

    // insert runs in the background; consumers await ctx.logId only when they actually need the id
    ctx.logId = (async () => {
      try {
        const logId = await db.table("log").insert(data);
        data.log_id = logId;
        return logId ? String(logId) : null;
      } catch (e) { console.error("initLog insert error:", e); return null; }
    })();

    ctx.logId.then(async () => { // background, after the main insert so data.id exists for the update below
      try {
        const urlIdOf = async (url: string) => {
          const hash = createHash("md5").update(url).digest("hex");
          return await db.one`SELECT id FROM log_url WHERE hash = ${hash}`
              || await db.table("log_url").insert({ url, hash });
        };
        const url = ctx.req.url.href;
        const referer = ctx.req.header("referer") ?? "";
        const ip = ctx.req.clientIp ?? "";
        const ua = ctx.req.header("user-agent") ?? "";

        const urlId = urlIdOf(url);
        const [url_id, referer_id, ip_id, user_agent_id] = await Promise.all([
          urlId,
          referer === url ? urlId : urlIdOf(referer), // reuse to avoid racing a duplicate log_url row
          db.one`SELECT id FROM log_ip WHERE ip = ${ip}`.then(id => id || db.table("log_ip").insert({ ip })),
          db.one`SELECT id FROM log_user_agent WHERE user_agent = ${ua}`.then(id => id || db.table("log_user_agent").insert({ user_agent: ua })),
        ]);

        await db.table("log").update(data.id, { url_id, referer_id, ip_id, user_agent_id });

      } catch (e) { console.error("liveLog background error:", e); }
    });

}
