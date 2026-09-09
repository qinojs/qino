import { bildJsonItem } from "../deps.ts";
import { uid } from "./crypto.ts";
import { header, cookiePrefix, unixTime } from "./util.ts";

import type { ItemProxy } from "../deps.ts";
import type { Ctx } from "./ctx/Ctx.ts";
import type { Req } from "./ctx/Req.ts";
import type { Db } from "./db/Db.ts";

const EMPTY_SESSION = "{}";
const COOKIE_NAME = "qinoSess";
const TOUCH_INTERVAL = 10; // seconds — `access` is read as "last online", never as an exact time

/** One session: identity (token/id), server-trusted reactive data, and its own touch timer. */
export class Session {
  #db: Db;
  #touchTimer: ReturnType<typeof setTimeout> | undefined;
  token: string;
  id: string;
  data: ItemProxy;
  /** The row's `settings` json, loaded with the session — `ctx.settings` reads it from here. */
  settings: string | null = null;
  /** Row state as loaded, so `touch()` can tell whether a write is needed at all. */
  access = 0;
  usrId = 0;
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

  get db(): Db { return this.#db; }

  /** Debounced per-session write of last access time and current user, at most once per interval. */
  touch(userId = 0): void {
    const time = unixTime();
    if (userId === this.usrId && time - this.access < TOUCH_INTERVAL) return;
    this.access = time;
    this.usrId = userId;
    clearTimeout(this.#touchTimer);
    this.#touchTimer = setTimeout(() => {
      this.#db.table("sess").update(this.id, { access: this.access, usr_id: this.usrId || null })
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
      ? await this.#db.row`SELECT id, data, settings, access, usr_id FROM sess WHERE token = ${cookieSessionToken}`
      : null;
    if (!row) return this.#create();
    const sess = new Session(this.#db, row.id, cookieSessionToken!, row.data, false);
    sess.settings = row.settings;
    sess.access = Number(row.access) || 0;
    sess.usrId = Number(row.usr_id) || 0;
    return sess;
  }

  async regenerateId(oldSessionToken: string): Promise<Session> {
    const row = oldSessionToken ? await this.#db.row`SELECT id, settings FROM sess WHERE token = ${oldSessionToken}` : null;
    if (!row) return this.#create();
    const token = uid();
    await this.#db.table("sess").update(row.id, { token, data: EMPTY_SESSION, access: unixTime() });
    const sess = new Session(this.#db, row.id, token, EMPTY_SESSION, true);
    sess.settings = row.settings; // the row keeps its settings, only identity and data are rotated
    sess.access = unixTime();
    return sess;
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
    const sess = new Session(this.#db, id, token, EMPTY_SESSION, true);
    sess.access = time;
    return sess;
  }
}
