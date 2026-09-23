// deno-lint-ignore-file no-explicit-any

// node_changed: one row per content change, with the request's log entry. Recorded via db events
// (like cms.versions), so every write through the table API is covered. Readers aggregate
// (EXISTS / GROUP BY node_id); duplicates are fine. Writes without request (cron/CLI/boot) are skipped.
import { hee, requestStorage } from "@qino/qino";

import type { App } from "@qino/qino";

type TFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<string>;

// tables whose rows belong to a node via their page_id column
const LINKED = new Set(["page_text", "page_url", "page_file", "page_access_grp", "page_access_usr"]);

export function initNodeChanged(app: App, signal: AbortSignal) {
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

    // the row's own id column — a text_lang row is addressed by the text it translates
    const idOf = (table: string, vs: Record<string, any>) =>
        LINKED.has(table) ? vs.page_id : table === "text_lang" ? vs.text_id : vs.id;

    // affected node ids; row values = key values merged with changed data.
    // text_lang/file rows are found via the link tables. New unlinked rows give none (the link
    // insert records it); a new language on an existing text is still found.
    const nodeIds = async (table: string, vs: Record<string, any>): Promise<number[]> => {
        const id = idOf(table, vs);
        if (table === "page" || LINKED.has(table)) return [Number(id)];
        if (table === "text_lang") {
            const links = await db.query`SELECT page_id FROM page_text WHERE text_id = ${id}
                UNION SELECT id FROM page WHERE title_id = ${id}`;
            return links.map((r) => Number(r.page_id));
        }
        if (table === "file") {
            const links = await db.query`SELECT page_id FROM page_file WHERE file_id = ${id}`;
            return links.map((r) => Number(r.page_id));
        }
        return [];
    };

    const capture = async (op: "insert" | "update" | "delete", e: any) => {
        const ctx = requestStorage.getStore();
        if (!ctx) return;
        const table = String(e.table);
        if (table !== "page" && table !== "text_lang" && table !== "file" && !LINKED.has(table)) return;
        const vs = { ...(e.id != null ? e.table.entryIdValues?.(e.id) : {}), ...e.data };
        if (idOf(table, vs) == null) return; // incomplete id (e.g. composite key as single value)
        const logId = Number(await ctx.logId) || 0;
        if (!logId) return;

        const nodes = await nodeIds(table, vs);
        if (!nodes.length) return;
        // page delete: resolve the page via basis before the row is gone.
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
            // fires insert-after, but node_changed itself is filtered out above
            await db.table("node_changed").insert({ log_id: logId, node_id: nodeId, page_id: pageId, data });
        }
    };

    db.on("table:insert-after", (e) => capture("insert", e), { signal });
    db.on("table:update-after", (e) => capture("update", e), { signal });
    // delete: captured before the row (and its basis chain) disappears
    db.on("table:delete-before", (e) => capture("delete", e), { signal });
}

// Readable label for a node_changed `data` payload ({ table, op, name?, lang?, cols? }). `t` is
// app.t. Here, so all history views describe changes the same way.
export async function describeChange(dataStr: unknown, t: TFn): Promise<string> {
    let d: any = {};
    try { d = JSON.parse(String(dataStr ?? "{}")); } catch { /* keep {} */ }
    const cols = Array.isArray(d.cols) ? d.cols : [];
    const lang = d.lang ? ` (${hee(d.lang)})` : "";
    switch (d.table) {
        case "page":
            if (d.op === "insert") return t`Created`;
            if (d.op === "delete") return t`Deleted`;
            if (cols.includes("visible")) return t`Visibility changed`;
            if (cols.includes("module")) return t`Module changed`;
            if (cols.includes("sort") || cols.includes("basis")) return t`Position changed`;
            return t`Setting changed`;
        case "page_text":
        case "text": // pre-split history
        case "text_lang":
            return (d.name ? `${await t`Text`} "${hee(d.name)}"` : await t`Text`) + lang + " " + await t`changed`;
        case "page_file":
        case "file":
            return d.op === "delete" ? await t`File deleted` : await t`File added`;
        case "page_url":
            return t`URL changed`;
        case "page_access_grp":
        case "page_access_usr":
            return t`Access changed`;
        default:
            return t`Changed`;
    }
}
