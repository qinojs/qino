import { hee } from "../core/lib/util.ts";
import { getCtx } from "../core/lib/RequestContext.ts";
import { backend } from "../cms.backend/mod.ts";
import type { Node } from "../cms/lib/Node.ts";
import type { App } from "../core/server.ts";
import api from "./nodeApi.ts";

export const name = "cms.backend.smalltext";
export const needs = ["cms.backend", "cms.text"];

export async function install({ app }: { app: App }): Promise<void> {
    const P = await backend.install(app, "cms.backend.smalltext");
    if (P) {
        await P.title("en", "Translate");
        await P.title("en", "Translate");
    }
}

export async function table(node: Node, { vars }: { vars?: Record<string, unknown> } = {}): Promise<string> {
    const ctx = getCtx();
    const db = node.app.db;
    const langs = node.app.languages.all as string[];
    const isSuperuser = !!(await ctx.user?.get("superuser"));
    const counterActive = !!(await node.app.settings["cms.backend.smalltext"]["counter"]);

    const v = vars ?? ctx.get;
    const search = String(v.search ?? "").trim();
    const orderRaw = String(v.order ?? "count");
    const dirRaw = String(v.dir ?? "desc").toLowerCase();
    const dir = dirRaw === "asc" ? "ASC" : "DESC";
    const sortable = ["namespace", "original", "count", ...langs];
    const order = sortable.includes(orderRaw) ? orderRaw : "count";

    const whereParts: string[] = [];
    const params: unknown[] = [];
    if (counterActive) whereParts.push("count > 0");
    if (search) {
        const cols = ["namespace", "original", ...langs].map(c => `${c} LIKE ?`).join(" OR ");
        whereParts.push(`(${cols})`);
        params.push(...Array(2 + langs.length).fill(`%${search}%`));
    }
    const where = whereParts.length ? "WHERE " + whereParts.join(" AND ") : "";

    const rows = await db.all(`SELECT * FROM smalltext ${where} ORDER BY ${order} ${dir} LIMIT 500`, params);
    const total = Number(await db.one("SELECT count(*) FROM smalltext"));

    const nextDir = (col: string) => col === order && dir === "DESC" ? "asc" : "desc";
    const sortMark = (col: string) => col === order ? (dir === "ASC" ? " ↑" : " ↓") : "";

    const langTh = langs.map(l => `<th data-sort="${hee(l)}" data-dir="${hee(nextDir(l))}">${hee(l)}${sortMark(l)}`).join("");
    const codeLogTh = isSuperuser ? "<th>code_logs" : "";

    let rowsHtml = "";
    for (const row of rows) {
        const langTds = langs.map(l =>
            `<td><textarea data-lang="${hee(l)}">${hee(row[l] ?? "")}</textarea>`
        ).join("");
        let codeLogTd = "";
        if (isSuperuser) {
            const logs = await db.all("SELECT * FROM smalltext_code_log WHERE hash = ? AND namespace = ?", [row.hash, row.namespace]);
            const links = logs.map((r) =>
                `<a href="${hee(r.file)}:${hee(String(r.line))}">${hee(r.file)}:${hee(String(r.line))}</a>`
            ).join("<br>");
            codeLogTd = `<td>${links}`;
        }
        rowsHtml += `<tr data-hash="${hee(String(row.hash))}" data-ns="${hee(String(row.namespace))}">
            <td class=-namespace>${hee(row.namespace)}
            <td><div class=-original>${hee(row.original)}</div>
            ${langTds}
            <td>${hee(String(row.count))}
            ${codeLogTd}
            <td>
                <button class=u2-unstyle data-action="translate_entry"><u2-ico icon=translate>↻</u2-ico></button>
            <td>
                <button class=u2-unstyle data-action="delete_entry"><u2-ico icon=delete>x</u2-ico></button>
        `;
    }

    return `
    <table class="u2-table -Sticky">
        <thead><tr>
            <th data-sort=namespace data-dir="${hee(nextDir("namespace"))}">NS${sortMark("namespace")}
            <th data-sort=original data-dir="${hee(nextDir("original"))}">original${sortMark("original")}
            ${langTh}
            <th data-sort=count data-dir="${hee(nextDir("count"))}">count${sortMark("count")}
            ${codeLogTh}
            <th width=10>
            <th width=10>
        <tbody>${rowsHtml}
    </table>
    <div class=-count>${hee(String(rows.length))} / ${hee(String(total))} entries</div>`;
}

async function render(node: Node): Promise<string> {
    const ctx = getCtx();
    const langs = node.app.languages.all as string[];
    const counterActive = !!(await node.app.settings["cms.backend.smalltext"]["counter"]);
    const codeLogActive = !!(await node.app.settings["cms.backend.smalltext"]["code_logger"]);
    const search = String(ctx.get.search ?? "").trim();

    const missing = Number(await node.app.db.one(
        `SELECT count(*) FROM smalltext WHERE ${langs.map(l => `${l} = ''`).join(" OR ")}`
    ));

    const app = node.app;
    return `<div class=u2-card>
    <div class=-head>${await app.t`Translate`}</div>
    <div class=-body>
        <label><input type=checkbox data-set=toggle_counter ${counterActive ? "checked" : ""}> ${await app.t`Counter`}</label>
        &nbsp;
        <button data-action=count_clean>${await app.t`Clear counter`}</button>
        &nbsp;&nbsp;
        <label><input type=checkbox data-set=toggle_code_log ${codeLogActive ? "checked" : ""}> ${await app.t`Code logger`}</label>
        &nbsp;
        <button data-action=code_log_clean>${await app.t`Clear log`}</button>
        &nbsp;&nbsp;
        <button data-action=delete_not_used>${await app.t`Delete unused`}</button>
        &nbsp;&nbsp;
        <button data-action=translate_untranslated>${await app.t`Translate missing`} (${hee(String(missing))})</button>
        <br>
        <input data-search value="${hee(search)}" placeholder="${await app.t`Search`}…">
    </div>
    <div style="overflow:auto; padding:0; max-height:90vh" cms-part="table">
        ${await table(node)}
    </div>

</div>`;
}

export async function backendDashboardWidget(app: App): Promise<string> {
    const db = app.db;
    const langs = app.languages.all as string[];
    const total   = Number(await db.one("SELECT count(*) FROM smalltext"));
    const missing = Number(await db.one(`SELECT count(*) FROM smalltext WHERE ${langs.map(l => `${l} = ''`).join(" OR ")}`));
    return `<div style="overflow:auto; padding:0">
<table class="u2-table" style="white-space:nowrap">
    <tr><td>${await app.t`Entries`}:<td>${hee(String(total))}
    <tr><td>${await app.t`Missing translations`}:<td>${hee(String(missing))}
</table>
</div>`;
}

export const cms = {
    node: {
        css: ["pub/main.css"],
        js: ["pub/main.js"],
        render,
        api,
        parts: { table },
    },
};
