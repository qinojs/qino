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
import { Access, App, DbFile, getCtx, s } from "@qino/qino";
import { cms, cmsCtx } from "@qino/qino/cms";

import { versedTables, historicalViews, initVers, shadowSchema } from "./lib/Vers.ts";
import { initHistory } from "./lib/History.ts";
import { initSpaces, versSpaceSchema } from "./lib/Spaces.ts";
import { getCmsVers, initHistoricalNodes, preventDbManipulations, cacheHeaders } from "./lib/CmsVers.ts";
import { getForNode, logDetails, publishNode } from "./serverInterface.ts";

import type { ApiTree, EventDecls } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

// import { ensureSpace } from "./lib/Spaces.ts"; // parked with draft/space mode

// import { applyDraftSpace, initDraftmode } from "./draftmode.ts"; // parked until read/write routing is complete
export { healthChecks } from "./healthChecks.ts";

Object.assign(App.events, {
  "vers:createSpace": {
    description: "A version space was created.",
    data: s.object({ space: s.number().describe("The space's id.") }),
  },
} satisfies EventDecls);

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
            input: s.object({ pid: s.number(), options: s.optional(s.object({
                fromSpace: s.optional(s.number()), fromLog: s.optional(s.number()),
                toSpace: s.optional(s.number()), subPages: s.optional(s.boolean()),
            })) }),
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
    app.on("route", ({ ctx }) => {
        const vs = getCmsVers(ctx);
        // Draft/space mode is parked; active history stays in live space 0.
        // await ensureSpace(ctx.app, vs.space);
        // await applyDraftSpace(ctx);
        // if (ctx.req.query.cms_versions_space !== undefined && ctx.req.query.cms_versions_space !== "active") {
        //     vs.space = Number(ctx.req.query.cms_versions_space) || 0;
        // }
        // a historical page's files carry its params too, but are resolved one by one (dbFile:resolve)
        if (ctx.req.appPath.startsWith("dbFile/")) return;
        vs.log = Number(ctx.req.query.cms_versions_log) || 0;

        // ── Log-mode: render a historical snapshot ────────────────────────────
        if (!vs.log) return;
        return (async () => {
            const pid = Number(ctx.req.query.cms_versions_page ?? 0);

            // Stopgap: the views are built up front, so without this check anyone could make the
            // database create and drop them. Per-node views would need an async tableRef().
            const page = await cms(app).node(pid);
            if (!page.exists() || await page.access() < 2) { vs.log = 0; return; }

            cacheHeaders(ctx);

            // No editmode in the historical view — only for this request (ctx.settings would persist)
            cmsCtx(ctx).editmode = 0;

            // Read from the historical views with request-own caches (core dbScope).
            await using _views = await historicalViews(ctx, vs.space, vs.log);

            const load = async (node: Node) => {
                await Promise.all((await node.conts()).map(load));
            };
            await load(await cms(app).node(pid));
        })();

        // ─── Space-mode: draft reads ──────────────────────────────────────────
        // TODO: full space-mode read routing requires the page:sql hook in
        // Page.ts to rewrite SQL table references + page:construct /
        // page:children overrides. See draftmode.ts.
    }, { signal });

    // ─── Log-mode files: shown as they were ─────────────────────────────────────
    // Every file is a request of its own: the page hands its log on to its file urls (a raw "&" is
    // safe in attributes, <style> and <script>), and dbFile:resolve serves the snapshot.
    app.on("respond", ({ ctx }) => {
        const { log } = getCmsVers(ctx);
        const body = ctx.res.body;
        if (!log || typeof body !== "string" || !ctx.res.headers.get("Content-Type")?.startsWith("text/html")) return;
        const at = `cms_versions_log=${log}`;
        ctx.res.body = body.replace(/\/dbFile\/[^"'\s)<>?#]+(\?[^"'\s)<>#]*)?/g, (url, query) => url + (query ? "&" : "?") + at);
    }, { signal });

    app.on("dbFile:resolve", (e) => {
        const ctx = getCtx();
        const log = Number(ctx.req.query.cms_versions_log) || 0;
        if (log) return historicalFile(app, e, getCmsVers(ctx).space, log);
    }, { signal });

    // ─── page:render-after: add frontend JS ──────────────────────────────────────────
    cms(app).on("page:render-after", ({ ctx }) => {
        if (!cmsCtx(ctx).editmode || ctx.req.query.cms_noFrontend) return;
        return (async () => {
            const frontend = String(await ctx.app.settings.cms.frontend || "cms.frontend");
            ctx.res.html.jsData.cmsFrontend = frontend;
            ctx.res.html.scripts.add(ctx.req.moduleUrl + frontend + "/pub/inline/inline.js");
            ctx.res.html.scripts.add(ctx.req.moduleUrl + "cms.versions/pub/vers.mjs");
        })();
    }, { signal });

    // initDraftmode(app, signal); // parked until draft reads and writes are fully routed
}

/** The file as it was before log entry `log`: its latest snapshot then, gone if deleted. Only for
 *  who may edit a node the file is or was attached to — like the history of a page itself. A new
 *  DbFile — the cached one stays live. */
async function historicalFile(app: App, e: { id: number; file?: DbFile }, space: number, log: number) {
    const nodes = await app.db.query`SELECT page_id FROM page_file WHERE file_id = ${e.id}
        UNION SELECT page_id FROM _vers_page_file WHERE file_id = ${e.id}`;
    if (!await someEditable(app, nodes.map((r) => Number(r.page_id)))) return;
    const row = await app.db.row`SELECT * FROM _vers_file WHERE id = ${e.id} AND _vers_space = ${space}
        AND _vers_log BETWEEN 1 AND ${log - 1} ORDER BY _vers_log DESC LIMIT 1`;
    if (!row) return; // no snapshot that old: the live file
    const { _vers_log, _vers_space, _vers_deleted, ...vs } = row;
    e.file = new DbFile(app.dbFiles, e.id, Number(_vers_deleted) ? {} : vs);
}

async function someEditable(app: App, ids: number[]) {
    for (const id of ids) {
        const node = await cms(app).node(id);
        if (node.exists() && await node.access() >= 2) return true;
    }
    return false;
}

/**
 * cms.versions install()
 * Tables (vers_space) are created via dbSchema/migrate.
 */
// export function install({app}: { app: App }): void { // tobi: I do not think this is needed
//     // Autovivify settings
//     app.settings["cms.versions"].draftmode;
// }
