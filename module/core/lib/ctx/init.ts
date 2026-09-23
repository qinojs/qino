import { createHash } from "node:crypto";

import { uid } from "../crypto.ts";
import { header, cookiePrefix, unixTime } from "../util.ts";
import { loginFromRequest } from "../auth/login.ts";

import type { Ctx } from "./Ctx.ts";

/** Per-request boot: client cookie, auth, session, settings, language, access log. */
export async function initRequest(ctx: Ctx): Promise<void> {
  await ctx.app.fire("authenticate", { ctx }); // tokens first: a Bearer beats a cookie
  ctx.sess ??= await ctx.app.sessions.loadFromRequest(ctx);
  await initClient(ctx);
  if (!ctx.statelessAuth) await loginFromRequest(ctx);
  ctx.sess.touch(ctx.userId);
  if (ctx.userId) await ctx.app.db.table("usr").get(ctx.userId); // one SELECT, then ctx.user is synchronous
  await ctx.initSettings();
  await ctx.app.languages.initCtx(ctx);
  initLog(ctx);
}

async function initClient(ctx: Ctx): Promise<void> {
  if (ctx.clientId) return;

  const cid = ctx.req.cookies[cookiePrefix(ctx.app.https, ctx.req.appUrl) + "cid"];
  if (!cid) return registerClient(ctx);
  const client = await ctx.app.db.table("client").rowBy("hash", cid); // SELECT *, so ctx.client is loaded
  if (!client) return registerClient(ctx);
  ctx.clientId = String(client);
}

async function registerClient(ctx: Ctx): Promise<void> {
  const hash = uid();
  ctx.res.headers.append(...header.setCookie("cid", hash, { path: ctx.req.appUrl, secure: ctx.app.https, maxAge: 5 * 365 * 24 * 60 * 60 }));
  const client = await ctx.app.db.table("client").add({ hash });
  ctx.clientId = String(client);
}


/** Secret keys in body and query. `sig`/`code`/`state` only as whole words (not `design`,
 *  `postcode`). Tested on the raw query first, so most requests never parse the URL. */
const SECRET = /pw|pass|token|secret|key|auth|\b(sig|code|state)\b/i;

/** Shorten long values (data: URI, base64), so the row doesn't overflow. */
const clip = (s: string, max: number) => s.length > max ? `${s.slice(0, max)}…(${s.length})` : s;

/** Enough to recognize a value across log lines, not enough to reuse it. */
const mask = (v: string) => v.length > 16 ? clip(v, 6) : "-----";

export function redactQuery(href: string): string {
  const q = href.indexOf("?");
  if (q < 0 || !SECRET.test(href.slice(q))) return href;
  try {
    const url = new URL(href);
    for (const [k, v] of [...url.searchParams]) if (SECRET.test(k)) url.searchParams.set(k, mask(v));
    return url.href;
  } catch { return href; }
}

const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const EMPTY_URL = md5(""); // most requests have no referer

function initLog(ctx: Ctx): void {

  const db = ctx.app.db;

  const data = {
    time: unixTime(),
    sess_id: ctx.sess?.id,
    client_id: ctx.clientId,
    post: ctx.req.body == null ? ""
      : clip(JSON.stringify(ctx.req.body, (k, v) => k && SECRET.test(k) ? mask(String(v)) : typeof v === "string" ? clip(v, 1000) : v), 10000),
  };

  // id of the row with that value, inserted on first sight. rowBy caches the row, so repeats cost
  // nothing.
  const dictId = async (name: string, field: string, value: string, rest?: Record<string, unknown>) => {
    const table = db.table(name);
    const row = await table.rowBy(field, value);
    return row ? String(row) : await table.insert({ [field]: value, ...rest });
  };

  const urlIdOf = (url: string) => dictId("log_url", "hash", url ? md5(url) : EMPTY_URL, { url });

  // Runs in the background; ctx.logId is awaited only when needed. Must run as one unit, or its
  // last step could wait behind a transaction that waits for it.
  ctx.logId = db.unit(async () => {
    try {
      const url = redactQuery(ctx.req.url.href);
      const referer = redactQuery(ctx.req.header("referer") ?? "");
      const ip = ctx.req.clientIp ?? "";
      const ua = ctx.req.header("user-agent") ?? "";

      const urlId = urlIdOf(url);
      const [url_id, referer_id, ip_id, user_agent_id] = await Promise.all([
        urlId,
        referer === url ? urlId : urlIdOf(referer), // reuse, avoids a duplicate log_url row
        dictId("log_ip", "ip", ip),
        dictId("log_user_agent", "user_agent", ua),
      ]);

      const logId = await db.table("log").insert({ ...data, url_id, referer_id, ip_id, user_agent_id });
      return logId ? String(logId) : null;
    } catch (e) { console.error("log write error:", e); return null; }
  });

}
