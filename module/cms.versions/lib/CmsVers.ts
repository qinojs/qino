// deno-lint-ignore-file no-explicit-any

import { getCtx, requestStorage, sql, type RequestContext, type Db, type App } from "../../core/mod.ts";
import { versedTables, setVers, view } from "./Vers.ts";
import { tableEntriesCopyTo } from "./Spaces.ts";
import type { Node } from "../../cms/mod.ts";

// ─── Per-request state: the cms-selected space/log (draftmode/request params) ─

export interface CmsVersState {
    space: number;
    log: number;
}

const STATE_KEY = "cms.versions";

export function getCmsVers(ctx: RequestContext): CmsVersState {
    ctx.state[STATE_KEY] ??= { space: 0, log: 0 };
    return ctx.state[STATE_KEY] as CmsVersState;
}

/**
 * Pre-load all page data into the runtime cache so that subsequent reads
 * inside a specific space/log still see correct values.
 */
export async function nodeLoadRuntimeCache(node: Node): Promise<void> {
    await node.files();
    const ctx = getCtx();
    for (const l of ctx.app.languages.all) {
        await node.title(l);
        await node.urlSeo(l);
        const texts = await node.texts();
        for (const text of Object.values(texts)) {
            await text.lang(l).get();
        }
    }
}

/**
 * Copy a page (and optionally sub-pages) from one space/log to another space.
 * Used for publish (draft → live) and rollback (old log → live).
 */
export async function copyNode(
    db: Db,
    pid: number,
    fromSpace: number,
    fromLog: number,
    toSpace: number,
    subPages = false,
): Promise<void> {
    const ctx = getCtx();

    const generate = async (id: number): Promise<void> => {
        const Page = await ctx.app.cms.node(id);
        if ((await Page.access()) <= 1) return;

        await tableEntriesCopyTo(db, "page",      { id },        fromSpace, fromLog, toSpace);
        const pageFilter = subPages ? { basis: id } : { basis: id, type: "c" };
        await tableEntriesCopyTo(db, "page",      pageFilter,    fromSpace, fromLog, toSpace);
        await tableEntriesCopyTo(db, "page_file", { page_id: id }, fromSpace, fromLog, toSpace);
        await tableEntriesCopyTo(db, "page_text", { page_id: id }, fromSpace, fromLog, toSpace);
        await tableEntriesCopyTo(db, "page_url",  { page_id: id }, fromSpace, fromLog, toSpace);

        // Copy title text
        const toPageView = await view(db, "page", toSpace, 0);
        const titleId = await db.one`SELECT title_id FROM ${sql.id(toPageView)} WHERE id = ${id}`;
        if (titleId) await tableEntriesCopyTo(db, "text", { id: titleId }, fromSpace, fromLog, toSpace);

        // Copy content texts
        const toTextView = await view(db, "page_text", toSpace, 0);
        const textIds = await db.col`SELECT text_id FROM ${sql.id(toTextView)} WHERE page_id = ${id}`;
        for (const tid of textIds) {
            await tableEntriesCopyTo(db, "text", { id: tid }, fromSpace, fromLog, toSpace);
        }

        // Copy files
        const toFileView = await view(db, "page_file", toSpace, 0);
        const fileIds = await db.col`SELECT file_id FROM ${sql.id(toFileView)} WHERE page_id = ${id}`;
        for (const fid of fileIds) {
            await tableEntriesCopyTo(db, "file", { id: fid }, fromSpace, fromLog, toSpace);
        }

        // Recurse into children
        const childView = await view(db, "page", toSpace, 0);
        const childIds = await db.col`SELECT id FROM ${sql.id(childView)} WHERE basis = ${id} ${sql.raw(subPages ? "" : "AND type = 'c'")}`;
        for (const cid of childIds) await generate(Number(cid));
    };

    // Switch to fromSpace so Page.access() reads correct data
    const oldVers = setVers(ctx, [fromSpace, fromLog]);
    // Clear CMS page cache so space change takes effect
    ctx.app.cms.clearCache();
    await generate(pid);

    // Regenerate URLs in toSpace
    ctx.app.cms.clearCache();
    setVers(ctx, [toSpace, 0]);
    const P = await ctx.app.cms.node(pid);
    for (const l of ctx.app.languages.all) {
        const genUrl = await P.urlSeoGenerated?.(l);
        const curUrl = await P.urlSeo?.(l);
        if (genUrl !== curUrl) await P.urlSeoGen?.(l);
    }

    setVers(ctx, oldVers);
    // The copy wrote rows past the managers — drop all derived caches
    ctx.app.cms.clearCache();
    ctx.app.dbTexts.clearCache();
    ctx.app.dbFiles.clearCache();
}

/**
 * Block writes to versioned tables while a log-mode snapshot is rendered.
 * Registered once at init — the per-request log check happens in the handler
 * (registering per request would leak permanent app.db listeners).
 */
export function preventDbManipulations(app: App): void {
    const prevent = (e: any) => {
        const ctx = requestStorage.getStore();
        if (!ctx || !getCmsVers(ctx).log) return; // only in log-mode requests
        const name: string = String(e.Table);
        if (versedTables(app.db)[name] || name.startsWith("_vers_")) e.returnValue = false;
    };
    app.db.on("table::insert-before", prevent);
    app.db.on("table::update-before", prevent);
    app.db.on("table::delete-before", prevent);
}

export function cacheHeaders(ctx: any): void {
    const maxAge = 60 * 60 * 24 * 180;
    const d = new Date(Date.now() + maxAge * 1000).toUTCString();
    ctx.responseHeaders.set("Expires", d);
    ctx.responseHeaders.set("Cache-Control", `private, max-age=${maxAge}`);
    ctx.responseHeaders.set("Pragma", "private");
}
