// deno-lint-ignore-file no-explicit-any

// node_changed: one row per content mutation, keyed by the request's log entry.
// Captured at db-event level (like cms.versions history capture), so every write
// path through the table API is recorded — no per-method instrumentation needed.
// Consumers aggregate (EXISTS / GROUP BY node_id); duplicates are fine.
// Writes without request context (cron/CLI/boot) are not captured.

import { requestStorage, type App } from "../../core/mod.ts";

// tables whose rows belong to a node via their page_id column
const LINKED = new Set(["page_text", "page_url", "page_file", "page_access_grp", "page_access_usr"]);

export function initNodeChanged(app: App) {
    const db = app.db;

    // nearest ancestor of type 'p', starting at (and including) id
    const containingPage = async (id: number): Promise<number> => {
        let cur = id;
        for (let i = 0; i < 100; i++) {
            const row = await db.row`SELECT type, basis FROM page WHERE id = ${cur}`;
            if (!row || row.type === "p" || !row.basis) return cur;
            cur = Number(row.basis);
        }
        return cur;
    };

    // affected node ids for a mutation; row values = PK values merged with changed data.
    // text/file are shared reference rows — resolve the node(s) through the link tables.
    // A row with no link yet (brand-new text/file) resolves to none; its page_text/
    // page_file insert captures it. A new-language row on an existing text still links,
    // so multilingual edits are tracked.
    const nodeIds = async (table: string, vs: Record<string, any>): Promise<number[]> => {
        if (table === "page") return [Number(vs.id)];
        if (LINKED.has(table)) return [Number(vs.page_id)];
        if (table === "text") {
            const links = await db.query`SELECT page_id FROM page_text WHERE text_id = ${vs.id}
                UNION SELECT id FROM page WHERE title_id = ${vs.id}`;
            return links.map((r: any) => Number(r.page_id));
        }
        if (table === "file") {
            const links = await db.query`SELECT page_id FROM page_file WHERE file_id = ${vs.id}`;
            return links.map((r: any) => Number(r.page_id));
        }
        return [];
    };

    const capture = async (op: "insert" | "update" | "delete", e: any) => {
        const ctx = requestStorage.getStore();
        if (!ctx) return;
        const table = String(e.table);
        if (table !== "page" && table !== "text" && table !== "file" && !LINKED.has(table)) return;
        const vs = { ...(e.id != null ? e.table.entryId2Array?.(e.id) : {}), ...e.data };
        const logId = Number(await ctx.logId) || 0;
        if (!logId) return;

        const nodes = await nodeIds(table, vs);
        if (!nodes.length) return;
        // page delete: the row is gone right after, so the containing page is
        // resolved from basis (parent side) — keeps deleted nodes checkable.
        const fromBasis = table === "page" && op === "delete";
        const data = JSON.stringify({
            table, op,
            ...(vs.name != null && table !== "page" ? { name: vs.name } : {}),
            ...(vs.lang != null ? { lang: vs.lang } : {}),
            ...(table === "page" && op === "update" ? { cols: Object.keys(e.data ?? {}) } : {}),
        });
        for (const nodeId of nodes) {
            const start = fromBasis ? Number((await db.row`SELECT basis FROM page WHERE id = ${nodeId}`)?.basis) || nodeId : nodeId;
            const pageId = await containingPage(start);
            // fires insert-after, but the table filter above skips node_changed → no re-capture
            await db.table("node_changed").insert({ log_id: logId, node_id: nodeId, page_id: pageId, data });
        }
    };

    app.db.on("table:insert-after", (e) => capture("insert", e));
    app.db.on("table:update-after", (e) => capture("update", e));
    // delete: captured before the row (and its basis chain) disappears
    app.db.on("table:delete-before", (e) => capture("delete", e));
}
