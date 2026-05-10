/**
 * cms.versions/mod.ts
 * Port of cms.versions/qg.php + vers.events.php + history.php
 *
 * Versioned tables (qg_setting and page_class intentionally excluded):
 *   page, page_file, page_text, page_url, text, file
 *
 * What is fully active:
 *   - History capture: every insert/update/delete on versioned tables is
 *     written to the corresponding _vers_* shadow table.
 *   - Log-mode (historical view): qgCmsVersLog + qgCmsVersPage render a
 *     frozen snapshot of the page at that log entry.
 *   - vers_cms_page_changed tracking (history.php).
 *   - serverInterface: getForPage, logDetails, publishCont.
 *
 * What is commented out (TODO – draft/space-mode write routing):
 *   - table::insert/update/delete-before space routing
 *   - page::construct / page::children space-aware read overrides
 *   - page::sql SQL-rewrite hook (complex regex approach from PHP)
 */

// deno-lint-ignore-file no-explicit-any

import type { App } from "../core/server.ts";
import {
    versedTables,
    setSpace, setLog, setVers, getCmsVers,
    versTable, view, ensureSpace, dropRequestViews,
} from "./lib/Vers.ts";
import { pageLoadRuntimeCache, preventDbManipulations, cacheHeaders } from "./lib/CmsVers.ts";
import { getCtx, type RequestContext } from "../core/lib/RequestContext.ts";
import type { AptTree } from "../core/lib/apt.ts";
import { s } from "../core/lib/StandardSchema.ts";
import { getForPage, logDetails, publishCont } from "./serverInterface.ts";

export const name = "cms.versions";
export const needs = ["cms"];

export const settingsSchema = {
    properties: {
        draftmode: {
            type: "boolean",
            description: "Aktiviert den Entwurfsmodus fur versionierte Inhalte.",
        },
    },
};

export const api: AptTree = {
    "publish-cont": {
        post: {
            description: "Content/Page in einen Versions-Space publizieren.",
            input: s.object({ pid: s.number(), options: s.optional(s.record()) }),
            execute: ({ pid, options }: any, ctx: any) => publishCont(ctx, pid, options ?? {}),
        },
    },
    page: {
        ":page": {
            get: {
                description: "Versionsprotokoll fuer Seite und Inhalte lesen.",
                execute: ({ page }: any, ctx: any) => getForPage(ctx, page),
            },
        },
    },
    log: {
        ":log": {
            get: {
                description: "Details zu einem Versions-Log lesen.",
                execute: ({ log }: any, ctx: any) => logDetails(ctx, log),
            },
        },
    },
};

export function init(app: App) {

    app.aptTree["cms.versions"] = api;

    // ─── Define which tables are versioned ──────────────────────────────────
    // page: only the listed fields come from the version table (rest from live)
    versedTables["page"] = {
        id: 1, log_id: 1, log_id_ch: 1, type: 1, basis: 1,
        sort: 1, module: 1, visible: 1, searchable: 1, title_id: 1,
        name: 1, _cache: 1,
    };
    versedTables["page_file"]  = true;
    versedTables["page_text"]  = true;
    versedTables["page_url"]   = true;
    versedTables["text"]       = true;
    versedTables["file"]       = true;

    // ─── Ensure _vers_* tables exist on first action ─────────────────────────
    // Port of vers.events.php: qg::on('action', function() { versTable() })
    app.on("action", async e => {
        const ctx = e.ctx as RequestContext;
        for (const t of Object.keys(versedTables)) await versTable(ctx.app.db, t);
    });

    // ─── History capture: insert/update ──────────────────────────────────────
    // Port of vers.events.php $catch_update_insert
    // Writes a REPLACE INTO _vers_* for every tracked table mutation.
    const catchInsertUpdate = async (e: any) => {
        const ctx = getCtx();
        if (!ctx?.logId) return;
        const tableName: string = String(e.Table);
        // Handle writes directly to _vers_* (log=0 slot)
        if (tableName.startsWith("_vers_") && !e.data?._vers_log) return;  // already writing to vers table – just let it through
        const vt = await versTable(ctx.app.db, tableName);
        if (!vt) return;
        // Build field list from _vers_* table to ensure correct column order
        const versCols = await ctx.app.db.all(`SHOW COLUMNS FROM \`${vt}\``);
        const selects = versCols.map((c: any) => {
            const f = c.Field;
            if (f === "_vers_space")   return `${getCmsVers(ctx).versSpace}`;
            if (f === "_vers_log")     return ctx.logId;
            if (f === "_vers_deleted") return "0";
            if (f === "offset")        return "`offset`";
            return `\`${f}\``;
        });
        const where = e.Table.entryId2where(e.id);
        if (!where) return;
        await ctx.app.db.query(`REPLACE INTO \`${vt}\` SELECT ${selects.join(", ")} FROM \`${tableName}\` WHERE ${where}`);
    };
    app.db.on("table::update-after", catchInsertUpdate);
    app.db.on("table::insert-after", catchInsertUpdate);

    // ─── History capture: delete ──────────────────────────────────────────────
    // Port of vers.events.php delete handler
    app.db.on("table::delete-after", async (e: any) => {
        const ctx = getCtx();
        if (!ctx.logId) return;
        const tableName: string = String(e.Table);
        if (tableName.startsWith("_vers_") && !e.data?._vers_log) return;
        const vt = await versTable(ctx.app.db, tableName);
        if (!vt) return;
        const ids = e.Table.entryId2Array(e.id) ?? {};
        const data: Record<string, any> = {
            ...ids,
            _vers_log:     ctx.logId,
            _vers_space:   getCmsVers(ctx).versSpace,
            _vers_deleted: 1,
        };
        const VT = ctx.app.db.table(vt);
        const set = VT.valuesToSet(data);
        await ctx.app.db.query(`REPLACE INTO \`${vt}\` SET ${set}`);
    });

    // ─── AUTO_INCREMENT sync: vers insert → live table ────────────────────────
    // Port of vers.events.php: keep live table AUTO_INCREMENT ≥ shadow table
    app.db.on("table::insert-after", async (e: any) => {
        const ctx = getCtx();
        if (!ctx) return;
        if (getCmsVers(ctx).versSpace) return; // only in live space
        const tableName: string = String(e.Table);
        if (!tableName.startsWith("_vers_")) return;
        const originalTable = tableName.slice(6);
        const auto = e.Table.autoIncrement;
        if (!auto) return;
        const ids = e.Table.entryId2Array(e.id) ?? {};
        const value = parseInt(String(ids[String(auto)]));
        if (!value) return;
        await ctx.app.db.query(`ALTER TABLE \`${originalTable}\` AUTO_INCREMENT=${value + 1}`);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // DRAFT-MODE: space-routing for DB writes
    // TODO: uncomment to enable full draft-mode write routing.
    // Port of vers.events.php: insert/update/delete-before space handling.
    //
    // app.on("table::update-before", async (e: any) => {
    //     const ctx = getCtx();
    //     if (!ctx.versSpace) return;
    //     const tableName: string = String(e.Table);
    //     if (!versedTables[tableName]) return;
    //     const data = { ...e.data, ...e.Table.entryId2Array(e.id), _vers_log: 0, _vers_space: ctx.versSpace };
    //     // for partially-versioned tables (like page), push non-versioned fields to live table
    //     const fieldSpec = versedTables[tableName];
    //     if (typeof fieldSpec === "object") {
    //         const liveData: Record<string,any> = {};
    //         for (const [k, v] of Object.entries(e.data)) {
    //             if (!fieldSpec[k]) liveData[k] = v;
    //         }
    //         if (Object.keys(liveData).length) {
    //             const [set, params] = [e.Table.valuesToSet(liveData), Object.values(liveData)];
    //             await ctx.app.db.query(`UPDATE \`${tableName}\` SET ${set} WHERE ${e.Table.entryId2where(e.id)}`);
    //         }
    //     }
    //     const VT = ctx.app.db.table(`_vers_${tableName}`);
    //     await VT.update(data);
    //     e.returnValue = e.id;
    // });
    //
    // app.on("table::insert-before", async (e: any) => {
    //     const ctx = getCtx();
    //     if (!ctx.versSpace) return;
    //     const tableName: string = String(e.Table);
    //     if (!versedTables[tableName]) return;
    //     const data = { ...e.data, _vers_log: 0, _vers_space: ctx.versSpace };
    //     const VT = ctx.app.db.table(`_vers_${tableName}`);
    //     const id = await VT.insert(data);
    //     const ids = e.Table.entryId2Array(id);
    //     e.returnValue = e.Table.entryId(ids);
    //     const auto = e.Table.autoIncrement;
    //     if (auto) {
    //         const value = parseInt(String(ids?.[String(auto)]));
    //         if (value) await ctx.app.db.query(`ALTER TABLE \`${tableName}\` AUTO_INCREMENT=${value + 1}`);
    //     }
    // });
    //
    // app.on("table::delete-before", async (e: any) => {
    //     const ctx = getCtx();
    //     if (!ctx.versSpace) return;
    //     const tableName: string = String(e.Table);
    //     if (!versedTables[tableName]) return;
    //     const data = { ...(e.Table.entryId2Array(e.id) ?? {}), _vers_log: 0, _vers_space: ctx.versSpace, _vers_deleted: 1 };
    //     const VT = ctx.app.db.table(`_vers_${tableName}`);
    //     await VT.update(data);
    //     e.returnValue = true;
    // });
    // ─────────────────────────────────────────────────────────────────────────

    // ─── cross-space field sync for `page` table ─────────────────────────────
    // Some `page` fields (sort, basis, access, title_id) must stay in sync
    // with the live table even when we're in a space.
    // Port of qg.php: qg::on('table::update-before', ...) for page table.
    app.db.on("table::update-before", async (e: any) => {
        const ctx = getCtx();
        if (!ctx) return;
        if (!getCmsVers(ctx).versSpace) return;
        if (String(e.Table) !== "page") return;
        const liveData: Record<string, any> = {};
        for (const key of ["sort", "basis", "access", "title_id"]) {
            if (key in e.data) liveData[key] = e.data[key];
        }
        if (!liveData) return;
        const row = await ctx.app.db.row(
            `SELECT * FROM page WHERE ${e.Table.entryId2where(e.id)}`
        );
        if (!row) return;
        if (row.type !== "p") { delete liveData.sort; delete liveData.basis; }
        if (!Object.keys(liveData).length) return;
        const set = e.Table.valuesToSet(liveData);
        await ctx.app.db.query(
            `UPDATE page       SET ${set} WHERE ${e.Table.entryId2where(e.id)}`
        );
        await ctx.app.db.query(
            `UPDATE _vers_page SET ${set} WHERE ${e.Table.entryId2where(e.id)}`
        );
    });

    // ─── history.php: vers_cms_page_changed ──────────────────────────────────
    // Port of history.php
    const onModify = async (e: any) => {
        const Page = e.Page;
        if (!Page) return;
        const ctx = getCtx();
        const now = Math.floor(Date.now() / 1000);
        const path = await Page.Path?.() ?? [];
        for (const node of path) {
            const data: Record<string, any> = {
                page_id:        node.id,
                space:          getCmsVers(ctx).versSpace,
                changed_inside: now,
            };
            if (node === Page)                data.changed      = now;
            if (Page.Page && await node.in?.(Page.Page)) data.changed_page = now;
            await ctx.app.db.table("vers_cms_page_changed").ensure(data);
        }
    };
    app.on("page::modify-before",      onModify);
    app.on("page::file_upload-before", onModify);

    // Copy vers_cms_page_changed when a new space is created
    app.on("vers::createSpace", async (e: any) => {
        await app.db.query(
            `INSERT INTO vers_cms_page_changed ` +
            `SELECT page_id, ${e.space} as space, changed_inside, changed_page, changed ` +
            `FROM vers_cms_page_changed WHERE space = 0`
        );
    });

    // Inform client about changed pages after API calls (draftmode)
    app.on("serverInterface::after", async (e: any) => {
        const ctx = getCtx();
        if (!getCmsVers(ctx).cmsVersSpace) return;
        if (!e.fn?.startsWith("page::")) return;
        const pid = parseInt(String(e.args?.[0]));
        if (!pid) return;
        const P = await (ctx.app as any).cms.node(pid);
        const pids = [pid, P.Page?.id].filter(Boolean);
        for (const page_id of pids) {
            const versions = await ctx.app.db.indexCol(
                `SELECT space, UNIX_TIMESTAMP(changed_page) FROM vers_cms_page_changed WHERE page_id = ?`,
                [page_id]
            );
            if (!versions[0] || versions[1] > versions[0]) {
                ctx.state.Answer["cms_vers_changed"] ??= {};
                ctx.state.Answer["cms_vers_changed"][page_id] = true;
            }
        }
    });

    // ─── Request init ─────────────────────────────────────────────────────────
    // Port of qg.php bottom section: determine cmsVersSpace/cmsVersLog from
    // settings + request params.
    app.on("action", async e => {
        const ctx = e.ctx as RequestContext;

        const vs = getCmsVers(ctx);
        await ensureSpace(ctx.app.db, vs.cmsVersSpace);

        // Determine space from draftmode setting
        const draftmode = !!(await ctx.app.settings["cms.versions"].draftmode);
        if (draftmode) {
            vs.cmsVersSpace = ctx.state.editmode ? 1 : 0;
        }

        // Override from request params
        if (ctx.get.qgCmsVersSpace !== undefined && ctx.get.qgCmsVersSpace !== "active") {
            vs.cmsVersSpace = parseInt(ctx.get.qgCmsVersSpace) || 0;
        }
        vs.cmsVersLog = parseInt(ctx.get.qgCmsVersLog ?? "0") || 0;

        // ── Log-mode: render a historical snapshot ────────────────────────────
        if (vs.cmsVersLog) {
            const space = ctx.get.qgCmsVersSpace === "active"
                ? vs.cmsVersSpace
                : (parseInt(ctx.get.qgCmsVersSpace ?? "0") || vs.cmsVersSpace);
            vs.cmsVersSpace = space;

            const pid = parseInt(ctx.get.qgCmsVersPage ?? "0");
            preventDbManipulations(ctx.app);
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

            const oldVers = setVers(ctx, [space, vs.cmsVersLog]);
            if ((ctx.app as any).cms) ((ctx.app as any).cms as any)._Pages = {};
            await generate(pid);
            setVers(ctx, oldVers);
        }

        // ─── Space-mode: draft reads ──────────────────────────────────────────
        // TODO: full space-mode read routing requires the page::sql hook in
        // Page.ts to rewrite SQL table references + page::construct /
        // page::children overrides. See commented section below.
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TODO – SPACE-MODE READ ROUTING
    //
    // To enable full draft-mode reads, uncomment the following blocks AND
    // implement ctx.versSpace-aware SQL rewriting in cms/lib/Node.ts's sql()
    // method (port of the page::sql event in qg.php).
    //
    // app.on("page::construct", async ({ Page }) => {
    //     const ctx = getCtx();
    //     if (!ctx.cmsVersSpace || ctx.cmsVersLog) return;
    //     if (!Page.vs) {
    //         const spaceView = await view(ctx.app.db, "page", ctx.cmsVersSpace, 0);
    //         Page.vs = await ctx.app.db.row(
    //             `SELECT *, ${ctx.cmsVersSpace} AS vers_space FROM \`${spaceView}\` WHERE id = ?`, [Page.id]
    //         );
    //     }
    //     if (!Page.vs) return;
    //     const spaceNeeded = (await Page.access()) < 2 ? 0 : ctx.cmsVersSpace;
    //     if ((Page.vs.vers_space ?? 0) !== spaceNeeded) {
    //         Page.vs = await ctx.app.db.row(`SELECT * FROM page WHERE id = ?`, [Page.id]);
    //     }
    //     if (Page.vs && spaceNeeded) {
    //         const oldSpace = setSpace(ctx, spaceNeeded);
    //         await pageLoadRuntimeCache(Page);
    //         setSpace(ctx, oldSpace);
    //     }
    // });
    //
    // app.on("page::children", async ({ Page }) => {
    //     const ctx = getCtx();
    //     if (!ctx.cmsVersSpace || ctx.cmsVersLog || Page.Children !== null) return;
    //     const spaceView = await view(ctx.app.db, "page", ctx.cmsVersSpace, 0);
    //     const rows1 = await ctx.app.db.all(
    //         `SELECT *, ${ctx.cmsVersSpace} AS vers_space FROM \`${spaceView}\` WHERE basis = ? ORDER BY type DESC, sort`,
    //         [Page.id]
    //     );
    //     const rows2 = await ctx.app.db.all(
    //         `SELECT * FROM page WHERE basis = ? ORDER BY type DESC, sort`, [Page.id]
    //     );
    //     Page.Children = new Map();
    //     for (const row of [...rows1, ...rows2]) {
    //         if (Page.Children.has(row.id)) continue;
    //         const Child = await (ctx.app as any).cms.node(row.id, row);
    //         if (!Child.is()) continue;
    //         if (Child.vs.basis != Page.id) continue;
    //         Page.Children.set(row.id, Child);
    //     }
    // });
    // ─────────────────────────────────────────────────────────────────────────

    // ─── cms-ready: add frontend JS ──────────────────────────────────────────
    app.on("cms-ready", async (e) => {
        const ctx = e.ctx as RequestContext;
        if (!ctx.state.editmode) return;
        if (ctx.get.qgCmsNoFrontend) return;
        ctx.html.addJSM(ctx.sysURL + "cms.versions/pub/vers.mjs");
        const draftmode = !!(await ctx.app.settings["cms.versions"].draftmode);
        if (draftmode) {
            // Check if draft has changes newer than live
            const MainNode = (ctx.app as any).cms.MainNode;
            if (MainNode) {
                const versions = await ctx.app.db.indexCol(
                    `SELECT space, UNIX_TIMESTAMP(changed_page) FROM vers_cms_page_changed WHERE page_id = ?`,
                    [String(MainNode)]
                );
                if (versions[1] && (!versions[0] || versions[1] > versions[0])) {
                    ctx.state.js_data = ctx.state.js_data ?? {};
                    ctx.state.js_data.cms_vers_draft_changed = true;
                }
            }
            ctx.html.addJSM(ctx.sysURL + "cms.versions/pub/draftmode.mjs");
        }
    });

    // ─── File protection: don't delete files referenced in _vers_file ────────
    // Port of qg.php: qg::on('dbFile-remove-fs', ...)
    app.on("dbFile-remove-fs", async (e: any) => {
        const md5 = e.dbFile?.vs?.md5 ?? "";
        if (!md5) return;
        const inVers = await app.db.one(
            "SELECT id FROM _vers_file WHERE md5 = ?", [md5]
        ).catch(() => null);
        if (inVers) e.prevent = true;
    });

    // ─── Drop request-scoped VIEWs after response ─────────────────────────────
    app.on("respond", async () => {
        const ctx = getCtx();
        await dropRequestViews(ctx.app.db);
    });
}

/**
 * 
 * TODO: shoult be in dbschema and not by hand
 * 
 * cms.versions install()
 * Creates vers_space and vers_cms_page_changed tables.
 * Port of old cms.versions/dbscheme.xml
 */
export async function install({ app }: any): Promise<void> {
    const db = app.db;

    await db.query(`
        CREATE TABLE IF NOT EXISTS vers_space (
            space        INT(11)  NOT NULL,
            time_created DATETIME DEFAULT NULL,
            PRIMARY KEY (space)
        )
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS vers_cms_page_changed (
            page_id       INT(11)  NOT NULL,
            space         INT(11)  NOT NULL,
            changed_inside DATETIME DEFAULT NULL,
            changed_page   DATETIME DEFAULT NULL,
            changed        DATETIME DEFAULT NULL,
            PRIMARY KEY (page_id, space)
        )
    `);

    // Autovivify settings
    app.settings["cms.versions"].draftmode;
}
