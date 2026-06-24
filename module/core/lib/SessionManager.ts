import { bildJsonItem, type ItemProxy } from "../../../deps.ts";
import { uid } from "./util.ts";
import { sql } from "../../../deps.ts";
import type { Db } from "./Db.ts";
import type { Req } from "./Req.ts";
import type { RequestContext } from "./RequestContext.ts";

const EMPTY_SESSION = "{}";
const COOKIE_NAME = "qgSession";
const hostCookieName = (https: boolean) => https ? `__Host-${COOKIE_NAME}` : COOKIE_NAME;
const unixTime = () => Math.floor(Date.now() / 1000);

/** One session: identity (token/id), server-trusted reactive data, and its own touch timer. */
export class Session {
    #db: Db;
    #touchTimer: ReturnType<typeof setTimeout> | undefined;
    token: string;
    id: string;
    data: ItemProxy;
    isNew: boolean;

    constructor(db: Db, sessId: string | number, token: string, data: string | null, isNew: boolean) {
        this.#db = db;
        this.id = String(sessId);
        this.token = token;
        this.isNew = isNew;
        const root = bildJsonItem(data || EMPTY_SESSION, async (json: string) => {
            await this.#db.exec`UPDATE sess SET data = ${json} WHERE id = ${this.id}`;
        }, { debounce: 0 });
        this.data = root.proxy;
    }

    /** Debounced per-session write of last access time and current user. */
    touch(userId = 0): void {
        clearTimeout(this.#touchTimer);
        this.#touchTimer = setTimeout(async () => {
            try {
                await this.#db.exec`UPDATE sess SET ${sql.id("access")} = ${unixTime()}, usr_id = ${userId || null} WHERE id = ${this.id}`;
            } catch (e) { console.error("session touch error:", e); }
        }, 50);
    }
}

export class SessionManager {
    #db: Db;

    constructor(db: Db) {
        this.#db = db;
    }

    loadFromRequest(req: Req, https: boolean): Promise<Session> {
        return this.load(req.cookie(hostCookieName(https)));
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
        await this.#db.exec`UPDATE sess SET token = ${token}, data = ${EMPTY_SESSION}, ${sql.id("access")} = ${unixTime()} WHERE id = ${row.id}`;
        return new Session(this.#db, row.id, token, EMPTY_SESSION, true);
    }

    setCookie(ctx: RequestContext): void {
        const https = ctx.app.https;
        const parts = [`${hostCookieName(https)}=${ctx.sess.token}`, `Path=${ctx.appURL}`, "HttpOnly;SameSite=Lax"];
        if (https) parts.push("Secure");
        ctx.responseHeaders.append("Set-Cookie", parts.join("; "));
    }

    async #create(): Promise<Session> {
        const token = uid();
        const time = unixTime();
        const id = await this.#db.table('sess').insert({ token, time, access: time, data: EMPTY_SESSION });
        if (!id) throw new Error("Could not create session");
        return new Session(this.#db, id, token, EMPTY_SESSION, true);
    }
}
