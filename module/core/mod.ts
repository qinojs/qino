// deno-lint-ignore-file no-explicit-any

import "./lib/qgEntries.ts";
import dbSchema from "./dbschema.json" with { type: "json" };
import { Redirect } from "./lib/util.ts";
import { getCtx, type RequestContext } from "./lib/RequestContext.ts";
import { api } from "./apt.ts";
import type { App } from "./server.ts";

export const name = "core";
export { dbSchema };

// ───── Public API ──────────────────────────────────────────────────────────
// Curated surface for other modules / the future @qino/core package.
// Consumers import from here (or "@qino/core") instead of reaching into
// core/lib/* — so they depend on this stable contract, not the file layout.
// NOTE: core-internal files must NOT import from this barrel; they import their
// siblings in ./lib/* directly, to avoid import cycles.

// App + request context
export { App } from "./server.ts";
export { getCtx, RequestContext } from "./lib/RequestContext.ts";

// HTML & general utilities
export { hee, HtmlString, html, Output, uid, urlize, clientIp, sqlSearchHelper, itemReadDeep } from "./lib/util.ts";

// Schema
export { s } from "./lib/StandardSchema.ts";

// apt framework: action tree, errors, adapters
export {
  Access, AccessError, ConflictError, NotFoundError, ValidationError,
  invoke, toHono, toTools,
} from "./lib/apt/mod.ts";
export type { AptTree } from "./lib/apt/mod.ts";

// Database
export { Db } from "./lib/Db.ts";
export { DbEntry } from "./lib/DbEntry.ts";
export { DbField } from "./lib/DbField.ts";
export { DbFile } from "./lib/DbFileManager.ts";
export { DbText, DbTextLang } from "./lib/DbTextManager.ts";
export type { dbEntry_usr } from "./lib/qgEntries.ts";

// Modules
export { Module } from "./lib/ModuleManager.ts";

// Auth
export { login, pwHash } from "./lib/auth.ts";

// File transforms
export { FileTransformer } from "./lib/transform/index.ts";


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

    app.aptTree.core = api;

    const langsRaw = String(await app.settings.core.langs ?? "");
    app.languages.setLangs(langsRaw.split(","));

    app.on("action", async (e) => {
        const ctx = e.ctx as RequestContext;

        // HTTPS redirect
        const https = app.https;
        if (https && new URL(ctx.req.url).protocol !== "https:") {
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

    const logId = () => { try { return getCtx().logId; } catch { return null; } };
    app.db.on("table::insert-before", (e: any) => { const id = logId(); if (id) e.data.log_id = id; });
    app.db.on("table::update-before", (e: any) => { const id = logId(); if (id) e.data.log_id_ch = id; });

    app.on("login", async (data: any) => {
      const ctx = getCtx();
      if (!ctx.sessId) return;
      const { mergeSessionSettingsToUser } = await import("./lib/contextSettings.ts");
      await mergeSessionSettingsToUser(app.db, data.id, ctx.sessId);
      await ctx.initSettings();
    });

    app.on("respond", async (e) => {
        const ctx = e.ctx as RequestContext;

        ctx.responseHeaders.set("Accept-CH", "DPR");

        const enableRaw = String(await ctx.app.settings.core.csp.enable ?? "");
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
            if (ctx.cspReportUri) str += " report-uri " + ctx.cspReportUri + "; ";
            const headerName = "Content-Security-Policy" + (enable === "report only" ? "-Report-Only" : "");
            ctx.responseHeaders.set(headerName, str);
        }
    });
}
