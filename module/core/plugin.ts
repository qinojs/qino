// qino-module manifest for core. The public library API lives in ./mod.ts.

import "./lib/qgEntries.ts";
import dbSchema from "./dbschema.json" with { type: "json" };
import { Redirect, u2Root, itemRoot } from "./lib/util.ts";
import { getCtx } from "./lib/RequestContext.ts";
export { api } from "./apt.ts";
import type { App } from "./lib/App.ts";
import type { DbEvents } from "./lib/Db.ts";

export const name = "core";
export { dbSchema };

export const settingsSchema = {
    properties: {
        langs: {
            type: "string",
            description: "Comma-separated list of available language codes, e.g. en,de.",
        },
        uploadMaxFileSize: {
            type: "integer",
            description: "Maximum file size for uploads and remote file imports in bytes.",
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
                    description: "Off, report only, or fully enforce.",
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
    },
};

export const ctxSettingsSchema = {
    properties: {
        dev: { type: "boolean" },
        lang_ns: {
            description: "Optionale Sprachvorgaben pro Namespace.",
            additionalProperties: { type: "string" },
        },
        settingsTree: {
            properties: {
                opened: { type: "string" },
            },
        },
    },
};

export async function init(app: App) {

    app.on("html-ready", ({ ctx }) => {
        ctx.html.importMap.set("@qino/item/", itemRoot);
        ctx.html.importMap.set("@qino/u2/", u2Root);
        // core's own qino.js imports item.js; declare so uncdn proxies it (jsr.io serves raw files as text/html)
        ctx.csp["script-src"][itemRoot] = true;
    });

    const langsRaw = String(await app.settings.core.langs ?? "");
    app.languages.setLangs(langsRaw.split(","));

    app.on("action", async ({ ctx }) => {
        // HTTPS redirect
        const https = app.https;
        if (https && ctx.url.protocol !== "https:") {
            throw new Redirect("https://" + ctx.req.header("host") + ctx.requestUri, 301);
        }

        // HSTS
        if (https) {
            const set = app.settings.core.HSTS;
            const maxAge = Number(await set["max-age"]) || 0;
            if (maxAge) {
                let header = `max-age=${maxAge}`;
                if (await set.includeSubDomains) header += "; includeSubDomains";
                if (await set.preload) header += "; preload";
                ctx.responseHeaders.set("Strict-Transport-Security", header);
            }
        }

    });

    // stamp the current request's logId onto every write — except the log tables themselves
    // (the log insert would otherwise await its own pending logId → deadlock)
    const stampLogId = (field: string) => async (e: DbEvents["table::insert-before"]) => {
      if (/^log(_|$)/.test(String(e.Table))) return;
      try { const id = await getCtx().logId; if (id) e.data[field] = id; } catch { /* outside request context */ }
    };
    app.db.on("table::insert-before", stampLogId("log_id"));
    app.db.on("table::update-before", stampLogId("log_id_ch"));

    app.on("login", async ({ id }) => {
      const ctx = getCtx();
      if (!ctx.sess) return;
      const { mergeSessionSettingsToUser } = await import("./lib/contextSettings.ts");
      await mergeSessionSettingsToUser(app.db, id, ctx.sess.id);
      await ctx.initSettings();
    });

    app.on("respond", async ({ ctx }) => {
        ctx.responseHeaders.set("Accept-CH", "DPR");

        const enableRaw = String(await ctx.app.settings.core.csp.enable ?? "");
        const enable = enableRaw === "report only"
            ? "report only"
            : (enableRaw && enableRaw !== "0" && enableRaw !== "false" ? "enforce" : "");

        if (enable) {
            const headerName = "Content-Security-Policy" + (enable === "report only" ? "-Report-Only" : "");
            ctx.responseHeaders.set(headerName, ctx.csp.toHeader());
        }
    });
}
