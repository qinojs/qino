// deno-lint-ignore-file no-explicit-any
import { cmsCtx } from "@qino/qino/cms";
/**
 * cms.versions/draftmode.ts
 *
 * Draft-mode (space routing): with the `draftmode` setting on, editmode
 * works in space 1 while visitors see live (space 0); `publish-node`
 * copies draft → live.
 *
 * Parked: plugin.ts does not wire this file until read/write routing is complete.
 * Implemented pieces:
 *   - editmode → draft space selection (applyDraftSpace)
 *   - cross-space field sync for `page`
 *
 * What is commented out (TODO – space-mode write/read routing):
 *   - table:insert/update/delete-before space routing
 *   - node:construct / node:children space-aware read overrides
 *   - node:sql SQL-rewrite hook (complex regex approach)
 */

import { requestStorage, type Ctx, type App } from "@qino/qino";
import { getVers } from "./lib/Vers.ts";
import { getCmsVers } from "./lib/CmsVers.ts";

/** Draftmode: in editmode read/write the draft space (1) instead of live (0). */
export async function applyDraftSpace(ctx: Ctx): Promise<void> {
    const draftmode = !!(await ctx.app.settings["cms.versions"].draftmode);
    if (draftmode) getCmsVers(ctx).space = cmsCtx(ctx).editmode ? 1 : 0;
}

export function initDraftmode(app: App, signal: AbortSignal) {

    // ─────────────────────────────────────────────────────────────────────────
    // DRAFT-MODE: space-routing for DB writes
    // TODO: uncomment to enable full draft-mode write routing.
    //
    // app.on("table:update-before", async (e: any) => {
    //     const ctx = getCtx();
    //     if (!getVers(ctx).space) return;
    //     const tableName: string = String(e.table);
    //     if (!versedTables(ctx.app.db)[tableName]) return;
    //     const data = { ...e.data, ...e.table.entryIdValues(e.id), _vers_log: 0, _vers_space: getVers(ctx).space };
    //     // for partially-versioned tables (like page), push non-versioned fields to live table
    //     const fieldSpec = versedTables(ctx.app.db)[tableName];
    //     if (typeof fieldSpec === "object") {
    //         const liveData: Record<string,any> = {};
    //         for (const [k, v] of Object.entries(e.data)) {
    //             if (!fieldSpec[k]) liveData[k] = v;
    //         }
    //         if (Object.keys(liveData).length) {
    //             const set = e.table.valuesToFragment(liveData, undefined, true);
    //             const idValues = e.table.entryIdValues(e.id);
    //             const idWhere = e.table.valuesToFragment(idValues);
    //             await ctx.app.db.exec`UPDATE ${sql.id(tableName)} SET ${set} WHERE ${idWhere}`;
    //         }
    //     }
    //     const VT = ctx.app.db.table(`_vers_${tableName}`);
    //     await VT.update(data);
    //     e.returnValue = e.id;
    // });
    //
    // app.on("table:insert-before", async (e: any) => {
    //     const ctx = getCtx();
    //     if (!getVers(ctx).space) return;
    //     const tableName: string = String(e.table);
    //     if (!versedTables(ctx.app.db)[tableName]) return;
    //     const data = { ...e.data, _vers_log: 0, _vers_space: getVers(ctx).space };
    //     const VT = ctx.app.db.table(`_vers_${tableName}`);
    //     const id = await VT.insert(data);
    //     const ids = e.table.entryIdValues(id);
    //     e.returnValue = e.table.entryId(ids);
    //     const auto = e.table.autoIncrement;
    //     if (auto) {
    //         const value = Number(ids?.[String(auto)]);
    //         if (value) await (ctx.app.db.dialect === "mysql"
    //             ? ctx.app.db.query`ALTER TABLE ${sql.id(tableName)} AUTO_INCREMENT=${sql.raw(String(value + 1))}`
    //             : ctx.app.db.syncAutoIncrement(tableName, String(auto), value));
    //     }
    // });
    //
    // app.on("table:delete-before", async (e: any) => {
    //     const ctx = getCtx();
    //     if (!getVers(ctx).space) return;
    //     const tableName: string = String(e.table);
    //     if (!versedTables(ctx.app.db)[tableName]) return;
    //     const data = { ...(e.table.entryIdValues(e.id) ?? {}), _vers_log: 0, _vers_space: getVers(ctx).space, _vers_deleted: 1 };
    //     const VT = ctx.app.db.table(`_vers_${tableName}`);
    //     await VT.update(data);
    //     e.returnValue = true;
    // });
    // ─────────────────────────────────────────────────────────────────────────

    // ─── cross-space field sync for `page` table ─────────────────────────────
    // Some `page` fields (sort, basis, access, title_id) must stay in sync
    // with the live table even when we're in a space.
    app.db.on("table:update-before", async (e) => {
        const ctx = requestStorage.getStore();
        if (!ctx || !getVers(ctx).space) return;
        if (String(e.table) !== "page") return;
        const liveData: Record<string, any> = {};
        for (const key of ["sort", "basis", "access", "title_id"])
            if (key in e.data) liveData[key] = e.data[key];
        const idValues = e.table.entryIdValues(e.id);
        if (!idValues) return;
        const idWhere = e.table.valuesToFragment(idValues);
        const db = ctx.app.db;
        const row = await db.row`SELECT * FROM page WHERE ${idWhere}`;
        if (!row) return;
        if (row.type !== "p") { delete liveData.sort; delete liveData.basis; }
        if (!Object.keys(liveData).length) return;
        const set = e.table.valuesToFragment(liveData, undefined, true);
        await db.exec`UPDATE page       SET ${set} WHERE ${idWhere}`;
        await db.exec`UPDATE _vers_page SET ${set} WHERE ${idWhere}`;
    }, { signal });

    // Inform client about changed pages after API calls (draftmode)
    // app.on("serverInterface::after", async (e: any) => { // no longer exists! use something else
    //     const ctx = getCtx();
    //     if (!getCmsVers(ctx).space) return;
    //     if (!e.fn?.startsWith("page::")) return;
    //     const pid = Number(e.args?.[0]);
    //     if (!pid) return;
    //     const P = await cms(ctx.app).node(pid);
    //     const page = await P.page();
    //     const pids = [pid, page?.id].filter(Boolean);
    //     for (const page_id of pids) {
    //         const versions = await ctx.app.db.indexCol`SELECT space, changed_page FROM vers_cms_page_changed WHERE page_id = ${page_id}`;
    //         if (!versions[0] || (versions[1] as number) > (versions[0] as number)) {
    //             ctx.state.Answer["cms_vers_changed"] ??= {};
    //             ctx.state.Answer["cms_vers_changed"][page_id] = true;
    //         }
    //     }
    // });

    // ─────────────────────────────────────────────────────────────────────────
    // TODO – SPACE-MODE READ ROUTING
    //
    // To enable full draft-mode reads, uncomment the following blocks AND
    // implement space-aware SQL rewriting in cms/lib/Node.ts's sql()
    // method (the node:sql event).
    //
    // app.on("node:construct", async ({ node }) => {
    //     const ctx = getCtx();
    //     if (!getCmsVers(ctx).space || getCmsVers(ctx).log) return;
    //     if (!node.vs) {
    //         const spaceView = await view(ctx.app.db, "page", getCmsVers(ctx).space, 0);
    //         node.vs = await ctx.app.db.row`SELECT *, ${getCmsVers(ctx).space} AS vers_space FROM ${sql.id(spaceView)} WHERE id = ${node.id}`;
    //     }
    //     if (!node.vs) return;
    //     const spaceNeeded = (await node.access()) < 2 ? 0 : getCmsVers(ctx).space;
    //     if ((node.vs.vers_space ?? 0) !== spaceNeeded) {
    //         node.vs = await ctx.app.db.row`SELECT * FROM page WHERE id = ${node.id}`;
    //     }
    //     if (node.vs && spaceNeeded) {
    //         const oldSpace = setSpace(ctx, spaceNeeded);
    //         await nodeLoadRuntimeCache(node);
    //         setSpace(ctx, oldSpace);
    //     }
    // });
    //
    // app.on("node:children", async ({ node }) => {
    //     const ctx = getCtx();
    //     if (!getCmsVers(ctx).space || getCmsVers(ctx).log || node.Children !== null) return;
    //     const spaceView = await view(ctx.app.db, "page", getCmsVers(ctx).space, 0);
    //     const rows1 = await ctx.app.db.query`SELECT *, ${getCmsVers(ctx).space} AS vers_space FROM ${sql.id(spaceView)} WHERE basis = ${node.id} ORDER BY type DESC, sort`;
    //     const rows2 = await ctx.app.db.query`SELECT * FROM page WHERE basis = ${node.id} ORDER BY type DESC, sort`;
    //     node.Children = new Map();
    //     for (const row of [...rows1, ...rows2]) {
    //         if (node.Children.has(row.id)) continue;
    //         const Child = await (ctx.app as any).cms.node(row.id, row);
    //         if (!Child.exists()) continue;
    //         if (Child.vs.basis != node.id) continue;
    //         node.Children.set(row.id, Child);
    //     }
    // });
    // ─────────────────────────────────────────────────────────────────────────

    // ─── cms:page-ready: draftmode frontend ────────────────────────────────────────
    app.on("cms:page-ready", async ({ ctx }) => {
        if (!cmsCtx(ctx).editmode || ctx.req.query.cms_noFrontend) return;
        const draftmode = !!(await ctx.app.settings["cms.versions"].draftmode);
        if (!draftmode) return;
        ctx.res.html.scripts.add(ctx.req.moduleUrl + "cms.versions/pub/draftmode.mjs");
    }, { signal });
}
