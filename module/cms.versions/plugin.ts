/**
 * cms.versions/plugin.ts — cms wiring only.
 *
 * Versioned tables (qg_setting and page_class intentionally excluded):
 *   page, page_file, page_text, page_url, text, file
 *
 * What is fully active:
 *   - History capture: every insert/update/delete on versioned tables is
 *     written to the corresponding _vers_* shadow table (lib/History.ts).
 *   - Log-mode (historical view): cms_versions_log + cms_versions_page render a
 *     frozen snapshot of the page at that log entry.
 *   - serverInterface: getForNode, logDetails, publishNode.
 *
 * lib/Vers.ts + History.ts + Spaces.ts are the generic, cms-agnostic
 * versioning engine — keep them that way.
 * Draft-mode (space routing, partly TODO) is separated into draftmode.ts.
 */

// deno-lint-ignore-file no-explicit-any

import { type DbScope, Access, type AptTree, s, sql, type App } from "../core/mod.ts";
import { cms, cmsCtx } from "../cms/mod.ts";
import { versedTables, view, initVers, shadowSchema } from "./lib/Vers.ts";
import { initHistory } from "./lib/History.ts";
import { ensureSpace, initSpaces, versSpaceSchema } from "./lib/Spaces.ts";
import { getCmsVers, nodeLoadRuntimeCache, preventDbManipulations, cacheHeaders } from "./lib/CmsVers.ts";
import { getForNode, logDetails, publishNode } from "./serverInterface.ts";
import { applyDraftSpace, initDraftmode } from "./draftmode.ts";
export { healthChecks } from "./healthChecks.ts";

export const name = "cms.versions";
export const needs = ["cms"];

// Which cms tables are versioned (qg_setting and page_class intentionally excluded).
// true = version all fields; record = only these fields come from the version table
// (rest come from the live table).
const VERSED: Record<string, true | Record<string, 1>> = {
    page: {
        id: 1, log_id: 1, log_id_ch: 1, type: 1, basis: 1,
        sort: 1, module: 1, visible: 1, searchable: 1, title_id: 1,
        name: 1, settings: 1, _cache: 1,
    },
    page_file: true, page_text: true, page_url: true, text: true, file: true,
};

// Derive the _vers_* shadow tables from the merged schema (function-form dbSchema runs
// after the static merge), so they are created in one pass and visible to all modules.
export function dbSchema(merged: { properties: Record<string, any> }) {
    const properties: Record<string, any> = {
        vers_space: versSpaceSchema, // generic (Spaces.ts)
    };
    for (const t of Object.keys(VERSED)) {
        const source = merged.properties[t];
        if (!source) throw new Error(`cms.versions: no schema for versioned table "${t}"`);
        properties[`_vers_${t}`] = shadowSchema(source);
    }
    return { properties };
}

export const settingsSchema = {
    properties: {
        draftmode: {
            type: "boolean",
            description: "Enables draft mode for versioned content.",
        },
    },
};

export const api: AptTree = {
    "publish-node": {
        post: {
            description: "Publish a node (page/content) into a version space.",
            access: Access.USER,
            input: s.object({ pid: s.number(), options: s.optional(s.record()) }),
            execute: ({ pid, options }: any, ctx: any) => publishNode(ctx, pid, options ?? {}),
        },
    },
    node: {
        ":node": {
            get: {
                description: "Read version log for a node and its contents.",
                access: Access.USER,
                execute: ({ node }: any, ctx: any) => getForNode(ctx, node),
            },
        },
    },
    log: {
        ":log": {
            get: {
                description: "Read details of a version log entry.",
                access: Access.USER,
                execute: ({ log }: any, ctx: any) => logDetails(ctx, log),
            },
        },
    },
};

export function init(app: App, { signal }: { signal: AbortSignal }) {

    // Register versioned tables for the runtime engine (schema is wired via extendDbSchema).
    Object.assign(versedTables(app.db), VERSED);

    // Generic engine (lib/): core shadow tables/views, history capture, spaces
    initVers(app, signal);
    initHistory(app, signal);
    initSpaces(app, signal);

    // Log-mode write guard (active only in log-mode requests, see CmsVers.ts)
    preventDbManipulations(app, signal);

    // ─── Request init ─────────────────────────────────────────────────────────
    // settings + request params.
    app.on("route", async ({ ctx }) => {
        const vs = getCmsVers(ctx);
        await ensureSpace(ctx.app, vs.space);

        // Determine space from draftmode setting (see draftmode.ts)
        await applyDraftSpace(ctx);

        // Override from request params
        if (ctx.req.query.cms_versions_space !== undefined && ctx.req.query.cms_versions_space !== "active") {
            vs.space = Number(ctx.req.query.cms_versions_space) || 0;
        }
        vs.log = Number(ctx.req.query.cms_versions_log) || 0;

        // ── Log-mode: render a historical snapshot ────────────────────────────
        if (vs.log) {
            const pid = Number(ctx.req.query.cms_versions_page ?? "0");
            cacheHeaders(ctx);

            // Disable editmode for the historical view — request-only override;
            // writing ctx.settings would persist it for the whole session
            cmsCtx(ctx).editmode = 0;

            // Route reads through the historical views and give the request its
            // own caches (core dbScope) — the shared app caches stay untouched.
            const db = ctx.app.db;
            const tables: Record<string, string> = {};
            for (const t of Object.keys(versedTables(db))) tables[t] = await view(db, t, vs.space, vs.log);
            const scope: DbScope = ctx.state.dbScope = { tables, cache: {} };

            // Pre-load the viewed page (incl. conts) from the views into the
            // request cache; the rest of the request (layout, nav) renders live.
            const generate = async (id: number): Promise<void> => {
                const node = await cms(ctx.app).node(id);
                for (const subCont of await node.conts()) await generate(subCont.id);
                if ((await node.access()) < 2) return;
                (node.vs as any).online_start = (node.vs as any).online_end = 0; // request-scoped node — safe
                await nodeLoadRuntimeCache(node);
            };
            await generate(pid);
            delete scope.tables; // stop routing — the pre-loaded request cache stays
            for (const v of Object.values(tables)) await db.query`DROP VIEW IF EXISTS ${sql.id(v)}`; // historical views are one-shot
        }

        // ─── Space-mode: draft reads ──────────────────────────────────────────
        // TODO: full space-mode read routing requires the page:sql hook in
        // Page.ts to rewrite SQL table references + page:construct /
        // page:children overrides. See draftmode.ts.
    }, { signal });

    // ─── cms:page-ready: add frontend JS ──────────────────────────────────────────
    app.on("cms:page-ready", async ({ ctx }) => {
        if (!cmsCtx(ctx).editmode) return;
        if (ctx.req.query.cms_noFrontend) return;
        const frontend = String(await ctx.app.settings.cms.frontend || "cms.frontend.2");
        ctx.res.html.jsData.cmsFrontend = frontend;
        ctx.res.html.scripts.add(ctx.req.modulePath + frontend + "/pub/js/frontend.mjs");
        ctx.res.html.scripts.add(ctx.req.modulePath + "cms.versions/pub/vers.mjs");
    }, { signal });

    initDraftmode(app, signal);
}

/**
 * cms.versions install()
 * Tables (vers_space) are created via dbSchema/migrate.
 */
export function install({app}: { app: App }): void { // tobi: I do not think this is needed
    // Autovivify settings
    app.settings["cms.versions"].draftmode;
}
