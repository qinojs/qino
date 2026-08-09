
import { getCtx, requestStorage, sql, tableRef, type Ctx, type Db, type DbEvents, type App } from "../../core/mod.ts";
import { versedTables, setVers, view } from "./Vers.ts";
import { tableEntriesCopyTo } from "./Spaces.ts";
import { cms, type Node } from "../../cms/mod.ts";

// ─── Per-request state: the cms-selected space/log (draftmode/request params) ─

export type CmsVersState = {
    space: number;
    log: number;
};

const STATE_KEY = "cms.versions";

export function getCmsVers(ctx: Ctx): CmsVersState {
    ctx.state[STATE_KEY] ??= { space: 0, log: 0 };
    return ctx.state[STATE_KEY];
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
        for (const text of Object.values(await node.texts())) await text.lang(l).get();
    }
}

/** Select current or fully loaded historical nodes by current edit access. */
export function initHistoricalNodes(app: App, signal: AbortSignal): void {
    app.on("node:construct", async ({ node }) => {
        const ctx = requestStorage.getStore();
        if (!ctx?.state.dbScope?.tables || !getCmsVers(ctx).log) return;

        const historical = await app.db.row`SELECT * FROM ${sql.id(tableRef("page"))} WHERE id = ${node.id}`;
        const current = await app.db.row`SELECT * FROM page WHERE id = ${node.id}`;
        node.vs = current ?? historical ?? {};
        node.vs = (await node.access() >= 2 ? historical : current) ?? {};
        if (node.vs !== historical) return;
        node.vs.online_start = node.vs.online_end = 0;
        await nodeLoadRuntimeCache(node);
    }, { signal });

    app.on("node:children", async (e) => {
        const ctx = requestStorage.getStore();
        if (!ctx?.state.dbScope?.tables || !getCmsVers(ctx).log) return;
        const rows = await app.db.query`SELECT * FROM page WHERE basis = ${e.node.id} ORDER BY type DESC, sort, id DESC`;
        e.rows.push(...rows);
    }, { signal });
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
        const page = await cms(ctx.app).node(id);
        if (await page.access() <= 1) return;

        await tableEntriesCopyTo(db, "page",      { id },        fromSpace, fromLog, toSpace);
        const pageFilter = subPages ? { basis: id } : { basis: id, type: "c" };
        await tableEntriesCopyTo(db, "page",      pageFilter,    fromSpace, fromLog, toSpace);
        await tableEntriesCopyTo(db, "page_file", { page_id: id }, fromSpace, fromLog, toSpace);
        await tableEntriesCopyTo(db, "page_text", { page_id: id }, fromSpace, fromLog, toSpace);
        await tableEntriesCopyTo(db, "page_url",  { page_id: id }, fromSpace, fromLog, toSpace);

        // Copy title text
        const toPageView = view(db, "page", toSpace, 0);
        const titleId = await db.one`SELECT title_id FROM ${sql.id(toPageView)} WHERE id = ${id}`;
        if (titleId) await tableEntriesCopyTo(db, "text", { id: titleId }, fromSpace, fromLog, toSpace);

        // Copy content texts
        const toTextView = view(db, "page_text", toSpace, 0);
        const textIds = await db.col`SELECT text_id FROM ${sql.id(toTextView)} WHERE page_id = ${id}`;
        for (const tid of textIds) {
            await tableEntriesCopyTo(db, "text", { id: tid }, fromSpace, fromLog, toSpace);
        }

        // Copy files
        const toFileView = view(db, "page_file", toSpace, 0);
        const fileIds = await db.col`SELECT file_id FROM ${sql.id(toFileView)} WHERE page_id = ${id}`;
        for (const fid of fileIds) {
            await tableEntriesCopyTo(db, "file", { id: fid }, fromSpace, fromLog, toSpace);
        }

        // Recurse into children
        const childView = view(db, "page", toSpace, 0);
        const childIds = await db.col`SELECT id FROM ${sql.id(childView)} WHERE basis = ${id} ${sql.raw(subPages ? "" : "AND type = 'c'")}`;
        for (const cid of childIds) await generate(Number(cid));
    };

    // Switch to fromSpace so Page.access() reads correct data
    const oldVers = setVers(ctx, [fromSpace, fromLog]);
    try {
        // Clear CMS page cache so space change takes effect
        cms(ctx.app).clearCache();
        await generate(pid);

        // Regenerate URLs in toSpace
        cms(ctx.app).clearCache();
        setVers(ctx, [toSpace, 0]);
        const page = await cms(ctx.app).node(pid);
        for (const l of ctx.app.languages.all) {
            const genUrl = await page.urlSeoGenerated(l);
            const curUrl = await page.urlSeo(l);
            if (genUrl !== curUrl) await page.urlSeoGen(l);
        }
    } finally {
        setVers(ctx, oldVers);
        // The copy wrote rows past the managers — drop all derived caches
        cms(ctx.app).clearCache();
        ctx.app.dbTexts.clearCache();
        ctx.app.dbFiles.clearCache();
    }
}

/**
 * Block writes to versioned tables while a log-mode snapshot is rendered.
 * Registered once at init — the per-request log check happens in the handler
 * (registering per request would leak permanent app.db listeners).
 */
export function preventDbManipulations(app: App, signal: AbortSignal): void {
    const prevent = (e: DbEvents["table:insert-before"]) => {
        const ctx = requestStorage.getStore();
        if (!ctx || !getCmsVers(ctx).log) return; // only in log-mode requests
        const name = String(e.table);
        if (versedTables(app.db)[name] || name.startsWith("_vers_")) e.returnValue = false;
    };
    app.db.on("table:insert-before", prevent, { signal });
    app.db.on("table:update-before", prevent, { signal });
    app.db.on("table:delete-before", prevent, { signal });
}

export function cacheHeaders(ctx: Ctx): void {
    const maxAge = 60 * 60 * 24 * 180;
    ctx.res.headers.set("Cache-Control", `private, max-age=${maxAge}`);
}
