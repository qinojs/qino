/**
 * serverInterface.ts - deprecated legacy RPC handler
 * Port of core/lib/Api.class.php
 *
 * @deprecated Neue Schnittstellen muessen als apt-Routen implementiert werden.
 * Diese Schicht bleibt nur als Kompatibilitaetsadapter fuer alte $fn(...)-Clients.
 */

// deno-lint-ignore-file no-explicit-any

import { getCtx } from "./context.ts";
import { AnswerException, OutputException } from "./util.ts";
import type { RequestContext } from "../lib/context.ts";

export const serverInterface: Record<string, any> = {};


function resolveServerInterface(name: string): any {
    if (serverInterface[name]) return serverInterface[name];
    // const lower = name.toLowerCase();
    // if (serverInterface[lower]) return serverInterface[lower];
    console.error(`serverInterface[${name}] not found`);
}

let tokenCheckNeeded = true;

export async function call(fn: string, args: any[]): Promise<any> {
    let ret: any = null;
    let onAfter: any = false;
    let ok = true;

    // onBefore
    const m = fn.match(/^(.+)::(.+)$/);
    let callCtx: any = null;
    if (m) {
        const method = m[2];
        const cls = resolveServerInterface(m[1]);
        if (!cls) return null;
        onAfter = cls.onAfter ?? false;
        callCtx = Object.create(cls);
        callCtx.ctx = getCtx();
        if (typeof cls?.onBefore === "function") {
            const v = await cls.onBefore.call(callCtx, method, ...args);
            ok = v !== false;
        }
    }

    if (tokenCheckNeeded) checkToken(getCtx());
    tokenCheckNeeded = true;

    if (ok) {
        try {
            if (m) {
                const method = m[2];
                const cls = resolveServerInterface(m[1]);
                if (cls && typeof cls[method] === "function") {
                    ret = await cls[method].call(callCtx, ...(args ?? []));
                } else {
                    console.warn("[Api] Unknown serverInterface:", m[1] + "::" + method);
                }
            } else {
                // Plain function name (legacy)
                const handler = serverInterface[fn];
                if (typeof handler === "function") {
                    ret = await handler(...(args ?? []));
                } else {
                    console.warn("[Api] Unknown function:", fn);
                }
            }
        } catch (e: any) {
            const ctx = getCtx();
            ctx.state.Answer ??= {};
            if (e?.status === 403) {
                ctx.state.Answer["cmsWarning"] = await (ctx as any).app.t`Ihnen fehlen die nötigen Berechtigungen.`;
            } else if (e?.status === 404) {
                ctx.state.Answer["cmsWarning"] = await (ctx as any).app.t`Die Seite existiert nicht.`;
            } else if (e?.status === 409) {
                ctx.state.Answer["cmsError"] = e.message;
            } else {
                throw e;
            }
        }
    }

    // onAfter
    if (onAfter && m) {
        const method = m[2];
        if (typeof onAfter === "function") {
            await onAfter.call(callCtx, method, ...args);
        }
    }

    return ret;
}

/** Send JSON response and stop processing */
export function answer(data: Record<string, any>): never {
    const ctx = getCtx();
    if (ctx.state.Answer) Object.assign(data, ctx.state.Answer);
    throw new AnswerException(data);
}

export async function listen(ctx: RequestContext): Promise<void> {
    if (!ctx.post.askJSON) return;
    let data: Record<string, any> | null = null;
    try { data = JSON.parse(String(ctx.post["askJSON"])); }
    catch {
        console.warn("Invalid askJSON:", ctx.post["askJSON"]);
        return;
    }
    if (!data?.serverInterface) return;

    const siRaw: Record<string, any> = {};
    for (const [i, vs] of Object.entries(data.serverInterface as Record<string, any>)) {
        siRaw[i] = await call(vs.fn, vs.args);
    }
    // PHP json_encodes numeric-keyed arrays as JSON arrays
    const keys = Object.keys(siRaw);
    const isNumeric = keys.length > 0 && keys.every((k) => String(parseInt(k)) === k);
    const siValue = isNumeric
        ? keys.sort((a, b) => parseInt(a) - parseInt(b)).map((k) => siRaw[k])
        : siRaw;
    answer({ serverInterface: siValue });
}


function checkToken(ctx: RequestContext): void {
    if (!ctx.state.ASK?.["serverInterface"]) return; // no request from the client, no need to test token
    const qgToken = String(ctx.post.qgToken);
    if (!qgToken) {
        console.warn("hacking? qgToken not set");
        throw new OutputException("");
    }
    if (qgToken !== ctx.token) {
        answer({
            cmsError: "Die Session ist nicht gültig, Bitte neu laden!",
            info: "qgToken nicht gültig",
        });
    }
}
