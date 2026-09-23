// Plugin of core. The public API is in ./mod.ts.
import { randB64, sha256b64 } from "./lib/crypto.ts";
import { isOn, Redirect, u2Root, itemRoot } from "./lib/util.ts";
import { getCtx } from "./lib/ctx/Ctx.ts";
import { urlOf } from "./lib/App.ts";
import { registerRows } from "./lib/rows.ts";
import { pendingLogin } from "./lib/auth/factors.ts";

import type { App } from "./lib/App.ts";
import type { DbEvents } from "./lib/db/Db.ts";

export { api } from "./api.ts";
export { healthChecks } from "./healthChecks.ts";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

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
        // a pending login asks for the next factor on any page, not only the login page
        if (pendingLogin(ctx)) ctx.res.html.scripts.add(ctx.req.moduleUrl + "core/pub/js/finishLogin.mjs");
        
        // Must be here, not in the u2 module: `deno publish` doesn't touch pub/, so browser files keep
        // their bare specifiers and only this map resolves them; `@qino/u2/` is used by backend and
        // editor modules, not only via `u2.assets()`.
        // Open: pages without u2 still get the entry and the wider csp.
        ctx.res.html.importMap.set("@qino/u2/", u2Root);
        ctx.res.html.importMap.set("@qino/item-cdn/", itemRoot);

        // browser only: core's client api and module pub files — relative paths break across stores
        ctx.res.html.importMap.set("@qino/pub/", ctx.req.moduleUrl + "core/pub/js/");
        ctx.res.html.importMap.set("@qino/m/", ctx.req.moduleUrl); // core's own files use @qino/pub/
        // For files importing a cdn url directly (modules of other stores may). Mapping a url to itself
        // does nothing by itself, but uncdn rewrites map values, so the browser then loads it via the proxy.
        ctx.res.html.importMap.set(itemRoot, itemRoot);
        ctx.res.html.importMap.set(u2Root, u2Root);
        // What the map points to must be allowed by the csp.
        ctx.res.csp["script-src"][itemRoot] = true;
        ctx.res.csp["script-src"][u2Root] = true;
        ctx.res.csp["style-src"][u2Root] = true;
        ctx.res.csp["connect-src"][u2Root] = true;
    }, { signal });

    const langsRaw = String(await settings.langs ?? "");
    app.languages.setLangs(langsRaw.split(","));

    const transformTimeout = Number(await settings.transform.timeout ?? "");
    if (transformTimeout) app.fileTransformer.timeout = transformTimeout;

    app.on("route", async ({ ctx }) => {
        // HTTPS redirect
        const https = app.https;
        if (https && ctx.req.url.protocol !== "https:") {
            const url = ctx.req.url.toURL();
            url.protocol = "https:";
            throw new Redirect(url.href, 301);
        }

        // HSTS
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

        if (!await settings.url && ctx.user?.superuser) await settings.url(urlOf(ctx));
    }, { signal });

    // add the request's logId to every write — except the log tables
    // (the log insert would wait for its own logId → deadlock)
    const stampLogId = (field: string) => async (e: DbEvents["table:insert-before"]) => {
      if (/^log(_|$)/.test(String(e.table))) return;
      try { const id = await getCtx().logId; if (id) e.data[field] = id; } catch { /* outside request context */ }
    };
    app.db.on("table:insert-before", stampLogId("log_id"), { signal });
    app.db.on("table:update-before", stampLogId("log_id_ch"), { signal });

    app.on("auth:login", async ({ usrId }) => {
      const ctx = getCtx();
      if (!ctx.sess) return;
      const { mergeSessionSettingsToUser } = await import("./lib/ctx/contextSettings.ts");
      await mergeSessionSettingsToUser(app.db, usrId, ctx.sess.id);
      await ctx.initSettings();
    }, { signal });

    app.on("respond", async ({ ctx }) => {
        //ctx.res.headers.set("Accept-CH", "DPR");

        const enableRaw = String(await settings.csp.enable ?? "");
        const enable = enableRaw === "report only" ? "report only" : (isOn(enableRaw) ? "enforce" : "");

        if (enable) {
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

            const headerName = "Content-Security-Policy" + (enable === "report only" ? "-Report-Only" : "");
            ctx.res.headers.set(headerName, ctx.res.csp.toHeader());
        }
    }, { signal });
}
