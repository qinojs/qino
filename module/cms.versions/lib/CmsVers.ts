/**
 * cms.versions/lib/CmsVers.ts
 * Port of cms.versions/cms_vers.class.php
 *
 * Higher-level CMS versioning: publishCont, page cache warming.
 * qg_setting is intentionally excluded (not versioned in Deno port).
 */

// deno-lint-ignore-file no-explicit-any

import { getCtx } from "../../core/lib/context.ts";
import { versedTables, setVers, view, tableEntriesCopyTo } from "./Vers.ts";
import type { Db } from "../../core/lib/Db.ts";

/**
 * Pre-load all page data into the runtime cache so that subsequent reads
 * inside a specific space/log still see correct values.
 * Port of cms_vers::page_load_runtime_cache().
 */
export async function pageLoadRuntimeCache(node: any): Promise<void> {
    await node.files();
    const ctx = getCtx();
    for (const l of ctx.app.languages.all) {
        await node.title(l);
        await node.urlSeo(l);
        const texts = await node.texts();
        for (const Text of Object.values(texts)) {
            await (Text as any).lang(l).get();
        }
    }
}

/**
 * Copy a page (and optionally sub-pages) from one space/log to another space.
 * Port of cms_vers::publishCont().
 * qg_setting copying is intentionally omitted (settings are not versioned).
 */
export async function publishCont(
    db: Db,
    pid: number,
    fromSpace: number,
    fromLog: number,
    toSpace: number,
    subPages = false,
): Promise<void> {
    const ctx = getCtx();

    const generate = async (id: number): Promise<void> => {
        const Page = await (ctx.app as any).cms.node(id);
        if ((await Page.access()) <= 1) return;

        await tableEntriesCopyTo(db, "page",      { id },        fromSpace, fromLog, toSpace);
        const pageFilter = subPages ? { basis: id } : { basis: id, type: "c" };
        await tableEntriesCopyTo(db, "page",      pageFilter,    fromSpace, fromLog, toSpace);
        await tableEntriesCopyTo(db, "page_file", { page_id: id }, fromSpace, fromLog, toSpace);
        await tableEntriesCopyTo(db, "page_text", { page_id: id }, fromSpace, fromLog, toSpace);
        await tableEntriesCopyTo(db, "page_url",  { page_id: id }, fromSpace, fromLog, toSpace);

        // Copy title text
        const toPageView = await view(db, "page", toSpace, 0);
        const titleId = await db.one(`SELECT title_id FROM \`${toPageView}\` WHERE id = ?`, [id]);
        if (titleId) await tableEntriesCopyTo(db, "text", { id: titleId }, fromSpace, fromLog, toSpace);

        // Copy content texts
        const toTextView = await view(db, "page_text", toSpace, 0);
        const textIds = await db.col(`SELECT text_id FROM \`${toTextView}\` WHERE page_id = ?`, [id]);
        for (const tid of textIds) {
            await tableEntriesCopyTo(db, "text", { id: tid }, fromSpace, fromLog, toSpace);
        }

        // Copy files
        const toFileView = await view(db, "page_file", toSpace, 0);
        const fileIds = await db.col(`SELECT file_id FROM \`${toFileView}\` WHERE page_id = ?`, [id]);
        for (const fid of fileIds) {
            await tableEntriesCopyTo(db, "file", { id: fid }, fromSpace, fromLog, toSpace);
        }

        // Recurse into children
        const childView = await view(db, "page", toSpace, 0);
        const childIds = await db.col(
            `SELECT id FROM \`${childView}\` WHERE basis = ? ${subPages ? "" : "AND type = 'c'"}`,
            [id]
        );
        for (const cid of childIds) await generate(parseInt(String(cid)));
    };

    // Switch to fromSpace so Page.access() reads correct data
    const oldVers = setVers(ctx, [fromSpace, fromLog]);
    // Clear CMS page cache so space change takes effect
    if ((ctx.app as any).cms) ((ctx.app as any).cms as any)._Pages = {};
    await generate(pid);

    // Regenerate URLs in toSpace
    if ((ctx.app as any).cms) ((ctx.app as any).cms as any)._Pages = {};
    setVers(ctx, [toSpace, 0]);
    const P = await (ctx.app as any).cms.node(pid);
    for (const l of (ctx.app as any).languages.all) {
        const genUrl = await P.urlSeoGenerated?.(l);
        const curUrl = await P.urlSeo?.(l);
        if (genUrl !== curUrl) await P.urlSeoGen?.(l);
    }

    setVers(ctx, oldVers);
    if ((ctx.app as any).cms) ((ctx.app as any).cms as any)._Pages = {};
}

/**
 * Prevent all DB writes to versioned tables (used when browsing a historical log).
 * Port of cms_vers::preventDbManipulations().
 */
export function preventDbManipulations(app: any): void {
    const prevent = (e: any) => {
        const name: string = String(e.Table);
        if (versedTables[name] || name.startsWith("_vers_")) e.returnValue = false;
    };
    app.db.on("table::insert-before", prevent);
    app.db.on("table::update-before", prevent);
    app.db.on("table::delete-before", prevent);
}

/**
 * Set long-lived cache headers (content won't change for this log snapshot).
 * Port of cms_vers::cacheHeaders().
 */
export function cacheHeaders(ctx: any): void {
    const maxAge = 60 * 60 * 24 * 180;
    const expires = Math.floor(Date.now() / 1000) + maxAge;
    const d = new Date(expires * 1000).toUTCString();
    ctx.responseHeaders.set("Expires", d);
    ctx.responseHeaders.set("Cache-Control", `store, cache, max-age=${maxAge}, private`);
    ctx.responseHeaders.set("Pragma", "private");
}
