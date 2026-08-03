import { bildJsonItem, type ItemProxy } from "../deps.ts";
import { header, cookiePrefix, uid, unixTime } from "./util.ts";
import type { Db } from "./db/Db.ts";
import type { Req } from "./ctx/Req.ts";
import type { Ctx } from "./ctx/Ctx.ts";

const EMPTY_SESSION = "{}";
const COOKIE_NAME = "qinoSess";

/** One session: identity (token/id), server-trusted reactive data, and its own touch timer. */
export class Session {
  #db: Db;
  #touchTimer: ReturnType<typeof setTimeout> | undefined;
  token: string;
  id: string;
  data: ItemProxy;
  isNew: boolean;
  cookieSent = false;

  constructor(db: Db, sessId: string | number, token: string, data: string | null, isNew: boolean) {
    this.#db = db;
    this.id = String(sessId);
    this.token = token;
    this.isNew = isNew;
    this.data = bildJsonItem(data || EMPTY_SESSION, async (json: string) => {
      await this.#db.table("sess").update(this.id, { data: json });
    }, { debounce: 0 }).proxy;
  }

  /** Debounced per-session write of last access time and current user. */
  touch(userId = 0): void {
    clearTimeout(this.#touchTimer);
    this.#touchTimer = setTimeout(() => {
      this.#db.table("sess").update(this.id, { access: unixTime(), usr_id: userId || null })
        .catch(e => console.error("session touch error:", e));
    }, 50);
  }
}

export class SessionManager {
  #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  loadFromRequest(req: Req, https: boolean, appUrl: string): Promise<Session> {
    return this.load(req.cookies[cookiePrefix(https, appUrl) + COOKIE_NAME]);
  }

  async load(cookieSessionToken?: string): Promise<Session> {
    const row = cookieSessionToken
      ? await this.#db.row`SELECT id, data FROM sess WHERE token = ${cookieSessionToken}`
      : null;
    if (row) return new Session(this.#db, row.id, cookieSessionToken!, row.data, false);
    return this.#create();
  }

  async regenerateId(oldSessionToken: string): Promise<Session> {
    const row = oldSessionToken ? await this.#db.row`SELECT id FROM sess WHERE token = ${oldSessionToken}` : null;
    if (!row) return this.#create();
    const token = uid();
    await this.#db.table("sess").update(row.id, { token, data: EMPTY_SESSION, access: unixTime() });
    return new Session(this.#db, row.id, token, EMPTY_SESSION, true);
  }

  /** Send the cookie when the session was created or rotated this request (`regenerateId` yields a new-marked
   *  session). Idempotent per session object, so `login()` and the core request path can both call it. */
  setCookieIfNew(ctx: Ctx): void {
    if (!ctx.sess.isNew || ctx.sess.cookieSent) return;
    ctx.sess.cookieSent = true;
    ctx.res.headers.append(...header.setCookie(COOKIE_NAME, ctx.sess.token, ctx.req.appUrl, ctx.app.https));
  }

  async #create(): Promise<Session> {
    const token = uid();
    const time = unixTime();
    const id = await this.#db.table('sess').insert({ token, time, access: time, data: EMPTY_SESSION });
    if (!id) throw new Error("Could not create session");
    return new Session(this.#db, id, token, EMPTY_SESSION, true);
  }
}