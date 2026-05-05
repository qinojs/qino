/**
 * core/mod.ts - Core module hooks
 * Port of v9/m/core/qg.php
 */
// deno-lint-ignore-file no-explicit-any

import "./serverInterface.ts";
import "./lib/qgEntries.ts";
import dbSchema from "./dbschema.json" with { type: "json" };
import { RedirectError } from "./lib/util.ts";
import { $item } from "../../deps.ts";
import { getCtx, type RequestContext } from "./lib/context.ts";
import { api } from "./apt.ts";

import type { App } from "./server.ts";

export const name = "core";
export { dbSchema };

const qgSettingsSchema = {
    properties: {
        langs: {
            type: "string",
            description: "Kommagetrennte Liste der verfugbaren Sprachcodes, z.B. de,en.",
        },
        _secure: {
            type: "string",
            description: "Intern verwendeter Sicherheitsschlussel des Systems.",
        },
        lang_ns: {
            description: "Optionale Sprachvorgaben pro Namespace.",
            additionalProperties: { type: "string" },
        },
        HSTS: {
            description: "Einstellungen fur den Strict-Transport-Security-Header.",
            properties: {
                "max-age": {
                    type: "integer",
                    description: "Zeit in Sekunden, wie lange Browser HTTPS fur diese Domain erzwingen.",
                },
                includeSubDomains: {
                    type: "boolean",
                    description: "Bezieht die HSTS-Regel auch auf alle Subdomains.",
                },
                preload: {
                    type: "boolean",
                    description: "Erlaubt die Aufnahme in Browser-Preload-Listen, falls die Voraussetzungen erfullt sind.",
                },
            },
        },
        csp: {
            description: "Steuert, ob und wie eine Content-Security-Policy gesendet wird.",
            properties: {
                enable: {
                    type: "string",
                    enum: ["", "enforce", "report only"],
                    description: "Aus, nur melden oder voll aktiv durchsetzen.",
                },
            },
        },
    },
};

export const ctxSettingsSchema = {
    properties: {
        settingsTree: {
            properties: {
                opened: { type: "string" },
            },
        },
    },
};

export async function init(app: App) {

    app.aptTree.core = api;

    app.on("init", () => {
        const rootSchema = app.settings[$item].schema;
        rootSchema!.properties.qg = qgSettingsSchema;
    });

    const langsRaw = String(await app.settings.qg.langs ?? "");
    app.languages.setLangs(langsRaw.split(","));


    app.on("action", async ({ctx}) => {

        // HTTPS redirect
        const https = app.https;
        if (https && ctx.server.SCHEME === "http") {
            ctx.responseHeaders.set("Location", "https://" + ctx.server.HTTP_HOST + ctx.server.REQUEST_URI);
            ctx.responseStatus = 301;
            throw new RedirectError();
        }

        // HSTS
        if (https) {
            const set = app.settings.qg.HSTS;
            const maxAge = parseInt(String(await set["max-age"])) || 0;
            if (maxAge) {
                let header = `max-age=${maxAge}`;
                if (await set.includeSubDomains) header += "; includeSubDomains";
                if (await set.preload) header += "; preload";
                ctx.responseHeaders.set("Strict-Transport-Security", header);
            }
        }

    });

    // app.on("dbTablectxinsert-before", (data) => {
    //   const ctx = getCtx();
    //   if (ctx.logId) data.data["log_id"] = ctx.logId;
    // });
    // app.on("table::ctx-before", (data) => {
    //   const ctx = getCtx();
    //   if (ctx.logId) data.data["log_id_ch"] = ctx.logId;
    // });

    app.on("login", async (data: any) => {
      const ctx = getCtx();
      if (!ctx.sessId) return;
      const { mergeSessionSettingsToUser } = await import("./lib/CustomSettingItem.ts");
      await mergeSessionSettingsToUser(app.db, data.id, ctx.sessId);
      await ctx.initSettings();
    });

    app.on("respond", async (e) => {
        const ctx: RequestContext = e.ctx;

        ctx.responseHeaders.set("Accept-CH", "DPR");

        const enableRaw = String(await ctx.app.settings.qg.csp.enable ?? "");
        const enable = enableRaw === "report only"
            ? "report only"
            : (enableRaw && enableRaw !== "0" && enableRaw !== "false" ? "enforce" : "");

        if (enable) {
            ctx.csp["script-src"]["'report-sample'"] = 1;
            ctx.csp["style-src"]["'report-sample'"] = 1;

            if (ctx.csp["default-src"]["'none'"] && Object.keys(ctx.csp["default-src"]).length > 1) {
                delete ctx.csp["default-src"]["'none'"];
            }

            let str = "";
            for (const [type, allowed] of Object.entries(ctx.csp)) {
                str += type + " " + Object.keys(allowed).join(" ") + "; ";
            }
            if (ctx.cspReportUri) str += " report-uri " + ctx.cspReportUri;
            const headerName = "Content-Security-Policy" + (enable === "report only" ? "-Report-Only" : "");
            ctx.responseHeaders.set(headerName, str);
        }
    });
}
