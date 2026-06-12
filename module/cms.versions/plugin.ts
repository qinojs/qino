/**
 * cms.versions/plugin.ts — cms wiring only.
 *
 * Versioned tables (qg_setting and page_class intentionally excluded):
 *   page, page_file, page_text, page_url, text, file
 *
 * What is fully active:
 *   - History capture: every insert/update/delete on versioned tables is
 *     written to the corresponding _vers_* shadow table (lib/History.ts).
 *   - Log-mode (historical view): qgCmsVersLog + qgCmsVersPage render a
 *     frozen snapshot of the page at that log entry.
 *   - serverInterface: getForPage, logDetails, publishCont.
 *
 * lib/Vers.ts + History.ts + Spaces.ts are the generic, cms-agnostic
 * versioning engine — keep them that way.
 * Draft-mode (space routing, partly TODO) is separated into draftmode.ts.
 */

// deno-lint-ignore-file no-explicit-any

import { type RequestContext, Access, type AptTree, s, type App } from "../core/mod.ts";
import type {} from "../cms/mod.ts";
import { versedTables, setVers, initVers } from "./lib/Vers.ts";
import { initHistory } from "./lib/History.ts";
import { ensureSpace, initSpaces, installSpaces } from "./lib/Spaces.ts";
import { getCmsVers, pageLoadRuntimeCache, preventDbManipulations, cacheHeaders } from "./lib/CmsVers.ts";
import { getForPage, logDetails, publishCont } from "./serverInterface.ts";
import { applyDraftSpace, initDraftmode, installDraftmode } from "./draftmode.ts";

export const name = "cms.versions";
export const needs = ["cms"];

export const settingsSchema = {
    properties: {
        draftmode: {
            type: "boolean",
            description: "Enables draft mode for versioned content.",
        },
    },
};

export const api: AptTree = {
    "publish-cont": {
        post: {
            description: "Publish content/page into a version space.",
            access: Access.USER,
            input: s.object({ pid: s.number(), options: s.optional(s.record()) }),
            execute: ({ pid, options }: any, ctx: any) => publishCont(ctx, pid, options ?? {}),
        },
    },
    page: {
        ":page": {
            get: {
                description: "Read version log for page and contents.",
                access: Access.USER,
                execute: ({ page }: any, ctx: any) => getForPage(ctx, page),
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

export function init(app: App) {

    // ─── Define which cms tables are versioned ───────────────────────────────
    // page: only the listed fields come from the version table (rest from live)
    const versed = versedTables(app.db);
    versed["page"] = {
        id: 1, log_id: 1, log_id_ch: 1, type: 1, basis: 1,
        sort: 1, module: 1, visible: 1, searchable: 1, title_id: 1,
        name: 1, _cache: 1,
    };
    versed["page_file"]  = true;
    versed["page_text"]  = true;
    versed["page_url"]   = true;
    versed["text"]       = true;
    versed["file"]       = true;

    // Generic engine (lib/): core shadow tables/views, history capture, spaces
    initVers(app);
    initHistory(app);
    initSpaces(app);

    // Log-mode write guard (active only in log-mode requests, see CmsVers.ts)
    preventDbManipulations(app);

    // ─── Request init ─────────────────────────────────────────────────────────
    // settings + request params.
    app.on("action", async e => {
        const ctx = e.ctx as RequestContext;

        const vs = getCmsVers(ctx);
        await ensureSpace(ctx.app, vs.space);

        // Determine space from draftmode setting (see draftmode.ts)
        await applyDraftSpace(ctx);

        // Override from request params
        if (ctx.get.qgCmsVersSpace !== undefined && ctx.get.qgCmsVersSpace !== "active") {
            vs.space = Number(ctx.get.qgCmsVersSpace) || 0;
        }
        vs.log = Number(ctx.get.qgCmsVersLog ?? "0") || 0;

        // ── Log-mode: render a historical snapshot ────────────────────────────
        if (vs.log) {
            const pid = Number(ctx.get.qgCmsVersPage ?? "0");
            cacheHeaders(ctx);

            // Disable editmode for the historical view
            ctx.settings.cms.editmode(0);

            // Load page data into cache for the requested log
            const generate = async (id: number): Promise<void> => {
                const node = await ctx.app.cms.node(id);
                for (const SubCont of await node.conts()) await generate(SubCont.id);
                if ((await node.access()) < 2) return;
                (node.vs as any).online_start = (node.vs as any).online_end = 0;
                await pageLoadRuntimeCache(node);
            };

            const oldVers = setVers(ctx, [vs.space, vs.log]);
            if ((ctx.app as any).cms) ((ctx.app as any).cms as any)._Pages = {};
            await generate(pid);
            setVers(ctx, oldVers);
        }

        // ─── Space-mode: draft reads ──────────────────────────────────────────
        // TODO: full space-mode read routing requires the page::sql hook in
        // Page.ts to rewrite SQL table references + page::construct /
        // page::children overrides. See draftmode.ts.
    });

    // ─── cms-ready: add frontend JS ──────────────────────────────────────────
    app.on("cms-ready", async (e) => {
        const ctx = e.ctx as RequestContext;
        if (!ctx.cms.editmode) return;
        if (ctx.get.qgCmsNoFrontend) return;
        const frontend = String(await ctx.app.settings.cms.frontend || "cms.frontend.2");
        ctx.html.jsData.cmsFrontend = frontend;
        ctx.html.scripts.add(ctx.sysURL + frontend + "/pub/js/frontend.mjs");
        ctx.html.scripts.add(ctx.sysURL + "cms.versions/pub/vers.mjs");
    });

    initDraftmode(app);
}

/**
 * cms.versions install()
 * Creates vers_space (generic) and vers_cms_page_changed (draftmode) tables.
 */
export async function install({app}: { app: App }): Promise<void> {
    await installSpaces(app.db);
    await installDraftmode(app.db);

    // Autovivify settings
    app.settings["cms.versions"].draftmode;
}
