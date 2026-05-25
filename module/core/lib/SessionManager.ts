import { getCookie, bildJsonItem, type Context, type ItemProxy } from "../../../deps.ts";
import { uid } from "./util.ts";
import type { Db } from "./Db.ts";
import type { RequestContext } from "./RequestContext.ts";

const EMPTY_SESSION = "{}";
const COOKIE_NAME = "qgSession";
const hostCookieName = (https: boolean) => https ? `__Host-${COOKIE_NAME}` : COOKIE_NAME;
const unixTime = () => Math.floor(Date.now() / 1000);

type SessionResult = { sessionToken: string; sessId: string; session: ItemProxy; isNew: boolean };

export class SessionManager {
    #db: Db;
    #touchTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(db: Db) {
        this.#db = db;
    }

    loadFromRequest(c: Context, https: boolean): Promise<SessionResult> {
        return this.load(getCookie(c, hostCookieName(https)));
    }

    async load(cookieSessionToken?: string): Promise<SessionResult> {
        const row = cookieSessionToken
            ? await this.#db.row("SELECT id, data FROM sess WHERE token = ?", [cookieSessionToken])
            : null;
        if (row) return this.#result(row.id, cookieSessionToken!, row.data, false);
        return this.#create();
    }

    async regenerateId(oldSessionToken: string): Promise<SessionResult> {
        const row = oldSessionToken ? await this.#db.row("SELECT id FROM sess WHERE token = ?", [oldSessionToken]) : null;
        if (!row) return this.#create();
        const token = uid();
        await this.#db.exec("UPDATE sess SET token = ?, data = ?, `access` = ? WHERE id = ?", [token, EMPTY_SESSION, unixTime(), row.id]);
        return this.#result(row.id, token, EMPTY_SESSION, true);
    }

    touch(sessId: string | number, userId = 0): void {
        clearTimeout(this.#touchTimer);
        this.#touchTimer = setTimeout(async () => {
            try {
                await this.#db.exec("UPDATE sess SET `access` = ?, usr_id = ? WHERE id = ?", [unixTime(), userId || null, sessId]);
            } catch (e) { console.error("session touch error:", e); }
        }, 50);
    }

    setCookie(ctx: RequestContext): void {
        const https = ctx.app.https;
        const parts = [`${hostCookieName(https)}=${ctx.sessionToken}`, `Path=${ctx.appURL}`, "HttpOnly;SameSite=Lax"];
        if (https) parts.push("Secure");
        ctx.responseHeaders.append("Set-Cookie", parts.join("; "));
    }

    async #create() {
        const token = uid();
        const time = unixTime();
        const res = await this.#db.exec("INSERT INTO sess SET token = ?, time = ?, `access` = ?, data = ?", [token, time, time, EMPTY_SESSION]);
        if (!res.insertId) throw new Error("Could not create session");
        return this.#result(res.insertId, token, EMPTY_SESSION, true);
    }

    #result(sessId: string | number, token: string, data: string | null, isNew: boolean): SessionResult {
        const root = bildJsonItem(data || EMPTY_SESSION, async (json: string) => {
            await this.#db.exec("UPDATE sess SET data = ? WHERE id = ?", [json, sessId]);
        });
        return { sessionToken: token, sessId: String(sessId), session: root.proxy, isNew };
    }

}
