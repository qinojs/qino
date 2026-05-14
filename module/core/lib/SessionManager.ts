import { getCookie, bildJsonItem, type Context, type ItemProxy } from "../../../deps.ts";
import { uid } from "./util.ts";
import type { Db } from "./Db.ts";
import type { RequestContext } from "./RequestContext.ts";

const COOKIE_NAME = "qgSession";
const hostCookieName = (https: boolean) => https ? `__Host-${COOKIE_NAME}` : COOKIE_NAME;
const EMPTY_SESSION = "{}";

type SessionResult = { sessionToken: string; sessId: string; session: ItemProxy; isNew: boolean };

export class SessionManager {
    #db: Db;

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
        const token = this.#token();
        const time = this.#time();
        await this.#db.exec("UPDATE sess SET token = ?, data = ?, `access` = ? WHERE id = ?", [token, EMPTY_SESSION, time, row.id]);
        return this.#result(row.id, token, EMPTY_SESSION, true);
    }

    #touchTimer: number | undefined;
    touch(sessId: string | number, userId = 0): void {
        clearTimeout(this.#touchTimer);
        this.#touchTimer = setTimeout(async () => {
            try {
                await this.#db.exec("UPDATE sess SET `access` = ?, usr_id = ? WHERE id = ?", [this.#time(), userId || null, sessId]);
            } catch (e) { console.error("session touch error:", e); }
        }, 50);
    }

    setCookie(ctx: RequestContext): void {
        ctx.responseHeaders.append("Set-Cookie", this.cookieHeader(ctx));
    }

    cookieHeader(ctx: RequestContext, sessionToken = ctx.sessionToken): string {
        const https = ctx.app.https;
        return [
            `${hostCookieName(https)}=${sessionToken}`,
            `Path=/`,
            "HttpOnly",
            "SameSite=Lax",
            https ? "Secure" : "",
        ].filter(Boolean).join("; ");
    }

    async #create() {
        const token = this.#token();
        const time = this.#time();
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

    #token(): string {
        return uid();
    }

    #time(): number {
        return Math.floor(Date.now() / 1000);
    }
}
