/**
 * cms wiring of the versioning engine.
 *
 * Versioned tables: page, page_file, page_text, page_url, text, file
 * (not qg_setting and page_class).
 *
 * Active:
 *   - History: every write on a versioned table goes to its _vers_* table (lib/History.ts).
 *   - Log mode: cms_versions_log + cms_versions_page render the page as it was at a log entry.
 *   - serverInterface: getForNode, logDetails, publishNode.
 *
 * lib/Vers.ts, History.ts and Spaces.ts are the generic engine — keep them cms-agnostic.
 * Draft mode (space routing, partly TODO) is parked in draftmode.ts.
 */

// deno-lint-ignore-file no-explicit-any
import { Access, s } from "@qino/qino";
import { cms, cmsCtx } from "@qino/qino/cms";

import { versedTables, historicalViews, initVers, shadowSchema } from "./lib/Vers.ts";
import { initHistory } from "./lib/History.ts";
import { initSpaces, versSpaceSchema } from "./lib/Spaces.ts";
import { getCmsVers, initHistoricalNodes, preventDbManipulations, cacheHeaders } from "./lib/CmsVers.ts";
import { getForNode, logDetails, publishNode } from "./serverInterface.ts";

import type { ApiTree, App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

// import { ensureSpace } from "./lib/Spaces.ts"; // parked with draft/space mode

// import { applyDraftSpace, initDraftmode } from "./draftmode.ts"; // parked until read/write routing is complete
export { healthChecks } from "./healthChecks.ts";

// Which cms tables are versioned (qg_setting and page_class intentionally excluded).
// true = version all fields; record = only these fields come from the version table
// (rest come from the live table).
const VERSED: Record<string, true | Record<string, 1>> = {
    page: {
        id: 1, log_id: 1, log_id_ch: 1, type: 1, basis: 1,
        sort: 1, module: 1, visible: 1, searchable: 1, title_id: 1,
        name: 1, settings: 1, _cache: 1,
    },
    page_file: true, page_text: true, page_url: true, text: true, text_lang: true, file: true,
};

// Build the _vers_* tables from the merged schema (function-form dbSchema runs after the static
// merge), so they are created in one pass.
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
        // Draft/space mode is parked until its read/write routing is complete.
        // draftmode: {
        //     type: "boolean",
        //     description: "Enables draft mode for versioned content.",
        // },
    },
};

export const api: ApiTree = {
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

    // Register versioned tables for the runtime engine (schema is wired via dbSchema).
    Object.assign(versedTables(app.db), VERSED);

    // Generic engine (lib/): core shadow tables/views, history capture, spaces
    initVers(app, signal);
    initHistory(app, signal);
    initSpaces(app, signal);

    // Log-mode write guard (active only in log-mode requests, see CmsVers.ts)
    preventDbManipulations(app, signal);
    initHistoricalNodes(app, signal);

    // ─── Request init ─────────────────────────────────────────────────────────
    // settings + request params.
    app.on("route", async ({ ctx }) => {
        const vs = getCmsVers(ctx);
        // Draft/space mode is parked; active history stays in live space 0.
        // await ensureSpace(ctx.app, vs.space);
        // await applyDraftSpace(ctx);
        // if (ctx.req.query.cms_versions_space !== undefined && ctx.req.query.cms_versions_space !== "active") {
        //     vs.space = Number(ctx.req.query.cms_versions_space) || 0;
        // }
        vs.log = Number(ctx.req.query.cms_versions_log) || 0;

        // ── Log-mode: render a historical snapshot ────────────────────────────
        if (vs.log) {
            const pid = Number(ctx.req.query.cms_versions_page ?? "0");

            // Stopgap: the views are built up front, so without this check anyone could make the
            // database create and drop them. Per-node views would need an async tableRef().
            const page = await cms(app).node(pid);
            if (!page.exists() || await page.access() < 2) { vs.log = 0; return; }

            cacheHeaders(ctx);

            // No editmode in the historical view — only for this request (ctx.settings would persist)
            cmsCtx(ctx).editmode = 0;

            // Read from the historical views with request-own caches (core dbScope).
            await using _views = await historicalViews(ctx, vs.space, vs.log);

            const load = async (node: Node): Promise<void> => {
                for (const cont of await node.conts()) await load(cont);
            };
            await load(await cms(app).node(pid));
        }

        // ─── Space-mode: draft reads ──────────────────────────────────────────
        // TODO: full space-mode read routing requires the page:sql hook in
        // Page.ts to rewrite SQL table references + page:construct /
        // page:children overrides. See draftmode.ts.
    }, { signal });

    // ─── cms:page-ready: add frontend JS ──────────────────────────────────────────
    app.on("cms:page-ready", async ({ ctx }) => {
        if (!cmsCtx(ctx).editmode || ctx.req.query.cms_noFrontend) return;
        const frontend = String(await ctx.app.settings.cms.frontend || "cms.frontend.4");
        ctx.res.html.jsData.cmsFrontend = frontend;
        ctx.res.html.scripts.add(ctx.req.moduleUrl + frontend + "/pub/inline/inline.js");
        ctx.res.html.scripts.add(ctx.req.moduleUrl + "cms.versions/pub/vers.mjs");
    }, { signal });

    // initDraftmode(app, signal); // parked until draft reads and writes are fully routed
}

/**
 * cms.versions install()
 * Tables (vers_space) are created via dbSchema/migrate.
 */
// export function install({app}: { app: App }): void { // tobi: I do not think this is needed
//     // Autovivify settings
//     app.settings["cms.versions"].draftmode;
// }
