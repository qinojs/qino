// Plugin of core. The public API is in ./mod.ts.
import { randB64, sha256b64 } from "./lib/crypto.ts";
import { hostAllowed, isOn, Output, Redirect, u2Root, itemRoot } from "./lib/util.ts";
import { getCtx, requestStorage } from "./lib/ctx/Ctx.ts";
import { urlOf } from "./lib/App.ts";
import { registerRows } from "./lib/rows.ts";
import { pendingLogin } from "./lib/auth/factors.ts";
import { isLocalHost } from "./lib/fileStream.ts";
import { cleanLogs } from "./healthChecks.ts";
import { migrateSmalltext } from "./lib/LangManager.ts";
import { $item } from "./deps.ts";

import type { App } from "./lib/App.ts";
import type { DbEvents } from "./lib/db/DbEvents.ts";

export { api } from "./api.ts";
export { healthChecks } from "./healthChecks.ts";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

// Runs while the cron module is installed; core works without it.
export const cron = {
  logs: { every: "day", at: { hour: 3 }, jitter: 2 * 60 * 60, timeout: 60 * 60, run: cleanLogs },
};

// The password factor is part of core (column, form, check); only the declaration is needed.
export const authFactors = [{
    name: "password",
    label: "Password",
    stepUp: true,
    order: 60,
    has: async (app: App, usrId: number) => !!(await app.db.one`SELECT id FROM usr WHERE id = ${usrId} AND pw <> ''`),
}];

export const settingsSchema = {
    properties: {
        url: {
            type: "string",
            description: "Public address of this app, e.g. https://example.com/. Used wherever there is no request to read it from — links in mails, text messages and jobs. Filled in on its own from the first superuser request.",
        },
        hosts: {
            type: "string",
            "x-multiline": true,
            description: "Hosts the app answers on, one per line; \"*.example.com\" covers subdomains. Others get a 421. The host of url and local hosts (localhost, private IPs) always pass. Empty accepts any host.",
        },
        loginTwoFactor: {
            type: "boolean",
            default: false,
            description: "Ask for a second factor when signing in. Users who have none are let in with one.",
        },
        langs: {
            type: "string",
            description: "Comma-separated list of available language codes, e.g. en,de.",
        },
        uploadMaxFileSize: {
            type: "integer",
            description: "Maximum file size for uploads and remote file imports in bytes.",
            default: 100 * 1024 * 1024,
        },
        _secret: {
            type: "string",
            description: "Key for permanent app grants — generated automatically.",
        },
        HSTS: {
            description: "Settings for the Strict-Transport-Security header.",
            properties: {
                "max-age": {
                    type: "integer",
                    description: "Time in seconds that browsers enforce HTTPS for this domain.",
                },
                includeSubDomains: {
                    type: "boolean",
                    description: "Applies the HSTS rule to all subdomains as well.",
                },
                preload: {
                    type: "boolean",
                    description: "Allows inclusion in browser preload lists if requirements are met.",
                },
            },
        },
        csp: {
            description: "Controls whether and how a Content-Security-Policy is sent.",
            properties: {
                enable: {
                    type: "string",
                    enum: ["", "enforce", "report only"],
                    default: "report only",
                    description: "Off, report only, or fully enforce.",
                },
            },
        },
        keys: {
            description: "API keys per provider host, shared by all modules talking to that provider.",
            additionalProperties: { type: "string" },
        },
        sess: {
            description: "Settings for visitor sessions.",
            properties: {
                maxIdle: {
                    type: "integer",
                    default: 30 * 24 * 60 * 60,
                    description: "Seconds a session stays valid without a request. A visitor returning later is signed out and gets a new session. Empty or 0 keeps the default.",
                },
            },
        },
        smalltext: {
            properties: {
                counter: {
                    type: "boolean",
                    description: "Whether to count usage of smalltext entries.",
                },
            },
        },
        transform: {
            properties: {
                timeout: {
                    type: "number",
                    default: 60 * 10,
                    minimum: 0,
                    description: "Maximum time in seconds for a file-transform pipeline to run before aborting.",
                }
            }
        }
    },
};

export const ctxSettingsSchema = {
    properties: {
        dev: {
            type: "boolean",
            description: "Whether to enable development mode for this context.",
        },
        lang_ns: {
            description: "Optional language override per namespace.",
            additionalProperties: { type: "string" },
        },
        settingsTree: {
            properties: {
                opened: { type: "string" },
            },
        },
    },
};

export async function init(app: App, { signal }: { signal: AbortSignal }) {

    registerRows(app.db);

    const settings = app.settings.core;
    if (!await settings._secret) await settings._secret(randB64(32));

    app.on("html-ready", ({ ctx }) => {
        const moduleUrl = ctx.req.moduleUrl;
        // a pending login asks for the next factor on any page, not only the login page
        if (pendingLogin(ctx)) ctx.res.html.scripts.add(moduleUrl + "core/pub/js/finishLogin.mjs");
        
        // Must be here, not in the u2 module: in a checkout browser files keep their bare specifiers and
        // only this map resolves them; `@qino/u2/` is used by backend and editor modules, not only via
        // `u2.assets()`.
        // Open: pages without u2 still get the entry and the wider csp.
        const importMap = ctx.res.html.importMap;
        importMap.set("@qino/u2/", u2Root);
        importMap.set("@qino/item-cdn/", itemRoot);

        // browser only: core's client api and module pub files — relative paths break across stores
        importMap.set("@qino/pub/", moduleUrl + "core/pub/js/");
        importMap.set("@qino/m/", moduleUrl); // core's own files use @qino/pub/
        // `deno publish` rewrites the bare specifiers of pub/ files too, by deno.json: a published file
        // imports `u2Root`/`itemRoot` outright (modules of other stores may as well). Mapping a url to
        // itself does nothing by itself, but uncdn rewrites map values, so the browser then loads it via the proxy.
        importMap.set(itemRoot, itemRoot);
        importMap.set(u2Root, u2Root);
        // What the map points to must be allowed by the csp.
        ctx.res.csp["script-src"][itemRoot] = true;
        ctx.res.csp["script-src"][u2Root] = true;
        ctx.res.csp["style-src"][u2Root] = true;
        ctx.res.csp["connect-src"][u2Root] = true;
    }, { signal });

    // before any work, so no redirect or link is ever built from a forged host;
    // a local host can't point at the attacker, so it always passes
    app.on("request-start", async ({ request }) => {
        const list = String(await settings.hosts ?? "");
        if (!list) return;
        const host = new URL(request.url).hostname;
        if (isLocalHost(host)) return;
        const own = URL.parse(String(await settings.url ?? ""))?.hostname ?? "";
        if (!hostAllowed(`${list} ${own}`, host)) throw new Output("", { status: 421 });
    }, { signal });

    await migrateSmalltext(app.db); // before any locale is imported
    app.languages.setLangs(String(await settings.langs ?? ""));
    // changed in the backend or by a starter: it holds at once, not from the next start
    const langs = settings.langs[$item];
    langs.addEventListener("change", () => app.languages.setLangs(String(langs.get() ?? "")), { signal });

    const transformTimeout = Number(await settings.transform.timeout ?? "");
    if (transformTimeout) app.fileTransformer.timeout = transformTimeout;

    app.on("route", ({ ctx }) => {
        // HTTPS redirect
        const https = ctx.req.url.protocol === "https:";
        if (app.forceHttps && !https) {
            const url = ctx.req.url.toURL();
            url.protocol = "https:";
            throw new Redirect(url.href, 301);
        }
        if (!https && !ctx.user?.superuser) return;
        return (async () => {
            // HSTS, only valid on https: responses
            if (https) {
                const set = settings.HSTS;
                const maxAge = Number(await set["max-age"]) || 0;
                if (maxAge) {
                    let header = `max-age=${maxAge}`;
                    if (await set.includeSubDomains) header += "; includeSubDomains";
                    if (await set.preload) header += "; preload";
                    ctx.res.headers.set("Strict-Transport-Security", header);
                }
            }
            if (ctx.user?.superuser && !await settings.url) await settings.url(urlOf(ctx));
        })();
    }, { signal });

    // add the request's logId to every write — except the log tables
    // (the log insert would wait for its own logId → deadlock)
    const stampLogId = (field: string) => (e: DbEvents["table:insert-before"]) => {
      const logId = requestStorage.getStore()?.logId; // none outside a request context
      if (logId && !/^log(_|$)/.test(String(e.table))) return logId.then((id) => { if (id) e.data[field] = id; });
    };
    app.db.on("table:insert-before", stampLogId("log_id"), { signal });
    app.db.on("table:update-before", stampLogId("log_id_ch"), { signal });
    // Stamping waits for the log row, which may be queueing for a connection: wait with none in hand.
    // Holding one meanwhile, enough such transactions would block the pool for good.
    app.db.on("transaction:before", () => requestStorage.getStore()?.logId.then(() => {}), { signal });

    app.on("auth:login", async ({ usrId }) => {
      const ctx = getCtx();
      if (!ctx.sess) return;
      const { mergeSessionSettingsToUser } = await import("./lib/ctx/contextSettings.ts");
      await mergeSessionSettingsToUser(app.db, usrId, ctx.sess.id);
      await ctx.initSettings();
    }, { signal });

    app.on("respond", async ({ ctx }) => {
        //ctx.res.headers.set("Accept-CH", "DPR");

        const enable = String(await settings.csp.enable ?? "");
        const reportOnly = enable === "report only";

        if (reportOnly || isOn(enable)) {
            // Hashes, not nonces: they follow from the body, so they stay valid in any cache (CDN,
            // service worker). Only hash what the server built itself. A hash disables 'unsafe-inline'
            // (and with it style="" and onclick), so directives allowing inline get no hashes.
            const hash = async (directive: "script-src" | "style-src", bodies: Iterable<string>) => {
                const src = ctx.res.csp[directive];
                if (src["'unsafe-inline'"]) return;
                for (const body of bodies) src[`'sha256-${await sha256b64(body)}'`] = true;
            };
            if (ctx.res.hasHtml) {
                await hash("script-src", ctx.res.html.inlineScripts.keys());
                await hash("style-src", ctx.res.html.inlineStyles);
            }

            ctx.res.headers.set("Content-Security-Policy" + (reportOnly ? "-Report-Only" : ""), ctx.res.csp.toHeader());
        }
    }, { signal });
}
