import { createHash } from "node:crypto";

import { uid } from "../crypto.ts";
import { header, cookiePrefix, unixTime } from "../util.ts";
import { loginFromRequest } from "../auth/login.ts";

import type { Ctx } from "./Ctx.ts";

/** Per-request boot: client cookie, auth, session, settings, language, access log. */
export async function initRequest(ctx: Ctx): Promise<void> {
  await ctx.app.fire("authenticate", { ctx }); // explicit credentials first: a Bearer beats an ambient cookie
  if (!ctx.statelessAuth) {
    await initClient(ctx);
    await loginFromRequest(ctx);
    touchSession(ctx);
  }
  if (ctx.userId) await ctx.app.db.table("usr").get(ctx.userId); // one SELECT, then ctx.user reads synchronously
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
  ctx.res.headers.append(...header.setCookie("cid", hash, ctx.req.appUrl, ctx.app.https, 5 * 365 * 24 * 60 * 60));
  const client = await ctx.app.db.table("client").add({ hash });
  ctx.clientId = String(client);
}

function touchSession(ctx: Ctx): void {
  if (ctx.sess) ctx.sess.touch(ctx.userId);
}


/** Secrets by key name, in bodies and query alike. `sig`/`code`/`state` grant access on their own,
 *  word-bounded so they do not eat `design` or `postcode`. The same test gates the raw query first:
 *  without any such word no key can match, so the common request never parses a URL. */
const SECRET = /pw|pass|token|secret|key|auth|\b(sig|code|state)\b/i;

/** Clip a long value — one field (data: URI, base64) must not overflow the row. */
const clip = (s: string, max: number) => s.length > max ? `${s.slice(0, max)}…(${s.length})` : s;

/** Enough to recognise a value again across log lines, never enough to replay it. */
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
const EMPTY_URL = md5(""); // the referer most requests do not have

function initLog(ctx: Ctx): void {

  const db = ctx.app.db;

  const data = {
    time: unixTime(),
    sess_id: ctx.sess?.id,
    client_id: ctx.clientId,
    post: ctx.req.body == null ? ""
      : clip(JSON.stringify(ctx.req.body, (k, v) => k && SECRET.test(k) ? mask(String(v)) : typeof v === "string" ? clip(v, 1000) : v), 10000),
  };

  // id of the row holding that value, inserting it the first time it is ever seen. rowBy keeps
  // the row, so every repeat — same ip, same browser, same page — costs nothing.
  const dictId = async (name: string, field: string, value: string, rest?: Record<string, unknown>) => {
    const table = db.table(name);
    const row = await table.rowBy(field, value);
    return row ? String(row) : await table.insert({ [field]: value, ...rest });
  };

  const urlIdOf = (url: string) => dictId("log_url", "hash", url ? md5(url) : EMPTY_URL, { url });

  // Runs in the background; consumers await ctx.logId only when they actually need the id — so it
  // has to finish as one unit, or its last step queues behind a transaction that is waiting for it.
  ctx.logId = db.unit(async () => {
    try {
      const url = redactQuery(ctx.req.url.href);
      const referer = redactQuery(ctx.req.header("referer") ?? "");
      const ip = ctx.req.clientIp ?? "";
      const ua = ctx.req.header("user-agent") ?? "";

      const urlId = urlIdOf(url);
      const [url_id, referer_id, ip_id, user_agent_id] = await Promise.all([
        urlId,
        referer === url ? urlId : urlIdOf(referer), // reuse to avoid racing a duplicate log_url row
        dictId("log_ip", "ip", ip),
        dictId("log_user_agent", "user_agent", ua),
      ]);

      const logId = await db.table("log").insert({ ...data, url_id, referer_id, ip_id, user_agent_id });
      return logId ? String(logId) : null;
    } catch (e) { console.error("log write error:", e); return null; }
  });

}
