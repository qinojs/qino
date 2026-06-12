/**
 * cms.versions/draftmode.ts
 *
 * Draft-mode (space routing): with the `draftmode` setting on, editmode
 * works in space 1 while visitors see live (space 0); `publish-cont`
 * copies draft → live.
 *
 * What is active:
 *   - editmode → draft space selection (applyDraftSpace)
 *   - vers_cms_page_changed tracking + "unpublished changes" frontend hint
 *   - cross-space field sync for `page`
 *
 * What is commented out (TODO – space-mode write/read routing):
 *   - table::insert/update/delete-before space routing
 *   - page::construct / page::children space-aware read overrides
 *   - page::sql SQL-rewrite hook (complex regex approach from PHP)
 */

// deno-lint-ignore-file no-explicit-any

import { getCtx, requestStorage, type RequestContext, type App, type Db } from "../core/mod.ts";
import { getVers } from "./lib/Vers.ts";
import { getCmsVers } from "./lib/CmsVers.ts";

/** Draftmode: in editmode read/write the draft space (1) instead of live (0). */
export async function applyDraftSpace(ctx: RequestContext): Promise<void> {
    const draftmode = !!(await ctx.app.settings["cms.versions"].draftmode);
    if (draftmode) {
        getCmsVers(ctx).space = ctx.cms.editmode ? 1 : 0;
    }
}

export function initDraftmode(app: App) {

    // ─────────────────────────────────────────────────────────────────────────
    // DRAFT-MODE: space-routing for DB writes
    // TODO: uncomment to enable full draft-mode write routing.
    //
    // app.on("table::update-before", async (e: any) => {
    //     const ctx = getCtx();
    //     if (!getVers(ctx).space) return;
    //     const tableName: string = String(e.Table);
    //     if (!versedTables(ctx.app.db)[tableName]) return;
    //     const data = { ...e.data, ...e.Table.entryId2Array(e.id), _vers_log: 0, _vers_space: getVers(ctx).space };
    //     // for partially-versioned tables (like page), push non-versioned fields to live table
    //     const fieldSpec = versedTables(ctx.app.db)[tableName];
    //     if (typeof fieldSpec === "object") {
    //         const liveData: Record<string,any> = {};
    //         for (const [k, v] of Object.entries(e.data)) {
    //             if (!fieldSpec[k]) liveData[k] = v;
    //         }
    //         if (Object.keys(liveData).length) {
    //             const [set, setParams] = e.Table.valuesToFragment(liveData, undefined, true);
    //             const idValues = e.Table.entryId2Array(e.id);
    //             const [idWhere, idParams] = e.Table.valuesToFragment(idValues);
    //             await ctx.app.db.exec(`UPDATE \`${tableName}\` SET ${set} WHERE ${idWhere}`, [...setParams, ...idParams]);
    //         }
    //     }
    //     const VT = ctx.app.db.table(`_vers_${tableName}`);
    //     await VT.update(data);
    //     e.returnValue = e.id;
    // });
    //
    // app.on("table::insert-before", async (e: any) => {
    //     const ctx = getCtx();
    //     if (!getVers(ctx).space) return;
    //     const tableName: string = String(e.Table);
    //     if (!versedTables(ctx.app.db)[tableName]) return;
    //     const data = { ...e.data, _vers_log: 0, _vers_space: getVers(ctx).space };
    //     const VT = ctx.app.db.table(`_vers_${tableName}`);
    //     const id = await VT.insert(data);
    //     const ids = e.Table.entryId2Array(id);
    //     e.returnValue = e.Table.entryId(ids);
    //     const auto = e.Table.autoIncrement;
    //     if (auto) {
    //         const value = Number(ids?.[String(auto)]);
    //         if (value) await ctx.app.db.query(`ALTER TABLE \`${tableName}\` AUTO_INCREMENT=${value + 1}`);
    //     }
    // });
    //
    // app.on("table::delete-before", async (e: any) => {
    //     const ctx = getCtx();
    //     if (!getVers(ctx).space) return;
    //     const tableName: string = String(e.Table);
    //     if (!versedTables(ctx.app.db)[tableName]) return;
    //     const data = { ...(e.Table.entryId2Array(e.id) ?? {}), _vers_log: 0, _vers_space: getVers(ctx).space, _vers_deleted: 1 };
    //     const VT = ctx.app.db.table(`_vers_${tableName}`);
    //     await VT.update(data);
    //     e.returnValue = true;
    // });
    // ─────────────────────────────────────────────────────────────────────────

    // ─── cross-space field sync for `page` table ─────────────────────────────
    // Some `page` fields (sort, basis, access, title_id) must stay in sync
    // with the live table even when we're in a space.
    app.db.on("table::update-before", async (e: any) => {
        const ctx = requestStorage.getStore();
        if (!ctx) return;
        if (!getVers(ctx).space) return;
        if (String(e.Table) !== "page") return;
        const liveData: Record<string, any> = {};
        for (const key of ["sort", "basis", "access", "title_id"]) {
            if (key in e.data) liveData[key] = e.data[key];
        }
        if (!liveData) return;
        const idValues = e.Table.entryId2Array(e.id);
        if (!idValues) return;
        const [idWhere, idParams] = e.Table.valuesToFragment(idValues);
        const row = await ctx.app.db.row(`SELECT * FROM page WHERE ${idWhere}`, idParams);
        if (!row) return;
        if (row.type !== "p") { delete liveData.sort; delete liveData.basis; }
        if (!Object.keys(liveData).length) return;
        const [set, setParams] = e.Table.valuesToFragment(liveData, undefined, true);
        await ctx.app.db.exec(`UPDATE page       SET ${set} WHERE ${idWhere}`, [...setParams, ...idParams]);
        await ctx.app.db.exec(`UPDATE _vers_page SET ${set} WHERE ${idWhere}`, [...setParams, ...idParams]);
    });

    // ─── history.php: vers_cms_page_changed ──────────────────────────────────
    const onModify = async (e: any) => {
        const Page = e.Page;
        if (!Page) return;
        const ctx = getCtx();
        const now = Math.floor(Date.now() / 1000);
        const path = await Page.Path?.() ?? [];
        for (const node of path) {
            const data: Record<string, any> = {
                page_id:        node.id,
                space:          getVers(ctx).space,
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
    app.on("serverInterface::after", async (e: any) => { // gibt es nicht mehr! etwas anderes verwenden
        const ctx = getCtx();
        if (!getCmsVers(ctx).space) return;
        if (!e.fn?.startsWith("page::")) return;
        const pid = Number(e.args?.[0]);
        if (!pid) return;
        const P = await ctx.app.cms.node(pid);
        const page = await P.page();
        const pids = [pid, page?.id].filter(Boolean);
        for (const page_id of pids) {
            const versions = await ctx.app.db.indexCol(
                `SELECT space, UNIX_TIMESTAMP(changed_page) FROM vers_cms_page_changed WHERE page_id = ?`,
                [page_id]
            );
            if (!versions[0] || (versions[1] as number) > (versions[0] as number)) {
                ctx.state.Answer["cms_vers_changed"] ??= {};
                ctx.state.Answer["cms_vers_changed"][page_id] = true;
            }
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TODO – SPACE-MODE READ ROUTING
    //
    // To enable full draft-mode reads, uncomment the following blocks AND
    // implement space-aware SQL rewriting in cms/lib/Node.ts's sql()
    // method (port of the page::sql event in qg.php).
    //
    // app.on("page::construct", async ({ Page }) => {
    //     const ctx = getCtx();
    //     if (!getCmsVers(ctx).space || getCmsVers(ctx).log) return;
    //     if (!Page.vs) {
    //         const spaceView = await view(ctx.app.db, "page", getCmsVers(ctx).space, 0);
    //         Page.vs = await ctx.app.db.row(
    //             `SELECT *, ${getCmsVers(ctx).space} AS vers_space FROM \`${spaceView}\` WHERE id = ?`, [Page.id]
    //         );
    //     }
    //     if (!Page.vs) return;
    //     const spaceNeeded = (await Page.access()) < 2 ? 0 : getCmsVers(ctx).space;
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
    //     if (!getCmsVers(ctx).space || getCmsVers(ctx).log || Page.Children !== null) return;
    //     const spaceView = await view(ctx.app.db, "page", getCmsVers(ctx).space, 0);
    //     const rows1 = await ctx.app.db.all(
    //         `SELECT *, ${getCmsVers(ctx).space} AS vers_space FROM \`${spaceView}\` WHERE basis = ? ORDER BY type DESC, sort`,
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

    // ─── cms-ready: draftmode frontend ────────────────────────────────────────
    app.on("cms-ready", async (e) => {
        const ctx = e.ctx as RequestContext;
        if (!ctx.cms.editmode) return;
        if (ctx.get.qgCmsNoFrontend) return;
        const draftmode = !!(await ctx.app.settings["cms.versions"].draftmode);
        if (!draftmode) return;
        // Check if draft has changes newer than live
        const MainNode = ctx.cms.mainNode;
        if (MainNode) {
            const versions = await ctx.app.db.indexCol(
                `SELECT space, UNIX_TIMESTAMP(changed_page) FROM vers_cms_page_changed WHERE page_id = ?`,
                [String(MainNode)]
            );
            if (versions[1] && (!versions[0] || versions[1] > versions[0])) {
                ctx.html.jsData.cms_vers_draft_changed = true;
            }
        }
        ctx.html.scripts.add(ctx.sysURL + "cms.versions/pub/draftmode.mjs");
    });
}

/** Creates the vers_cms_page_changed table. TODO: should be in dbSchema and not by hand */
export async function installDraftmode(db: Db): Promise<void> {
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
}
