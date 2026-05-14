/**
 * cms.backend.superuser.error_report/mod.ts
 * Port of cms.backend.superuser.error_report/index.php + detail.php
 */

// deno-lint-ignore-file no-explicit-any

import { hee } from "../core/lib/util.ts";
import { urlToLocalPath } from "../core/lib/util.ts";
import { getCtx } from "../core/lib/RequestContext.ts";
import { Db } from "../core/lib/Db.ts";
import { backend } from "../cms.backend/mod.ts";
import type { Node } from "../cms/lib/Node.ts";

export const name = "cms.backend.superuser.error_report";

const u2time = (t: unknown) => {
  const d = t instanceof Date ? t : typeof t === "number" ? new Date(t * 1000) : typeof t === "string" ? new Date(t) : null;
  if (!d || isNaN(d.getTime())) return "";
  const iso = d.toISOString();
  return `<u2-time datetime="${iso}" type=relative>${iso.slice(0, 16).replace("T", " ")}</u2-time>`;
};
export const needs = ["cms.backend", "error_report"];

export async function install({ app }: any): Promise<void> {
  const P = await backend.install(app, "cms.backend.superuser.error_report");
  if (P) {
    await P.title("en", "Errors");
    await P.title("de", "Errors");
  }
}

function makeFileHelper(ctx: any) {
    const appURL = ctx.appURL as string;
    function editorLink(file: string, line: unknown, col: unknown): string {
        const localPath = urlToLocalPath(file, ctx) ?? file;
        return appURL + "editor/?file=" + encodeURIComponent(localPath)
            + "&line=" + encodeURIComponent(String(line ?? ""))
            + "&col="  + encodeURIComponent(String(col  ?? ""));
    }
    function fileDisplay(file: string): string {
        const localPath = urlToLocalPath(file, ctx);
        if (!localPath) return file;
        for (const mod of Object.values(ctx.app.modules.all() as Record<string, any>)) {
            if (mod.dir && localPath.startsWith(mod.dir)) return "m/" + mod.name + "/" + localPath.slice(mod.dir.length);
        }
        const mIdx = localPath.lastIndexOf("/m/");
        return mIdx >= 0 ? localPath.slice(mIdx + 1) : localPath;
    }
    return { editorLink, fileDisplay };
}

async function render(node: Node, { vars = {} }: { vars?: Record<string, any> } = {}): Promise<string> {
    const db  = node.app.db;
    const ctx = getCtx();
    const get = ctx.get;

    if (vars.delete) {
        const where = db.table("m_error_report").valuesToWhere(vars.delete);
        if (where) await db.query(`DELETE FROM m_error_report WHERE ${where}`);
    }
    if (vars.delete_foreign_js) {
        const host = ctx.req.header("host") ?? "";
        await db.query(
            "DELETE FROM m_error_report WHERE source = 'js' AND file NOT LIKE '/_%' AND file NOT LIKE ? AND file NOT LIKE ?", ["http://" + host + "%", "https://" + host + "%"]
        );
    }
    if (vars.deleteAll) {
        await db.query("DELETE FROM m_error_report");
    }

    if (get.id) return await renderDetail(node, Number(get.id));

    const order    = get.order ?? "max_id";
    const orderSql = order !== "num_ip" ? "max(e.id) DESC" : "num_ip DESC, num DESC";

    const rows = await db.all(
        `SELECT *,
            count(*)                    AS num,
            count(DISTINCT e.ip)        AS num_ip,
            max(e.time)                 AS time,
            sum(e.bot)                  AS num_bot,
            sum(e.unsupported_ua)       AS num_unsupported,
            (SELECT usr.email FROM log
                LEFT JOIN sess ON log.sess_id = sess.id
                LEFT JOIN usr  ON sess.usr_id = usr.id
                WHERE log.id = max(e.log_id)) AS usr_email
         FROM m_error_report e
            LEFT JOIN log  ON e.log_id  = log.id
            LEFT JOIN sess ON log.sess_id = sess.id
         GROUP BY source, file, line, col
         ORDER BY ${orderSql}`
    );

    const tools = `
<script type=module>
import { apt } from '${ctx.sysURL}core/pub/js/apt.js';
globalThis.cmsApi = (pid, vars) => apt.cms.node(pid).html.post({vars}).then(html => { document.querySelector('.-pid'+pid).outerHTML = html; });
</script>
<div class="c1-box" style="overflow:auto; width:auto; flex:0 0 auto">
    <div class="-head">Tools</div>
    <div class="-body">
        ${order === "num_ip"
            ? `<a href="?order=max_id">nach Datum sortieren</a><br>`
            : `<a href="?order=num_ip">nach Anzahl IPs sortieren</a><br>`}
        <br>
        Delete:<br>
        <button onclick="cmsApi(${node.id},{delete:{bot:'1',source:'404'}}); this.disabled=true">404 und Bots</button><br>
        <button onclick="cmsApi(${node.id},{delete:{unsupported_ua:'1',source:'404'}}); this.disabled=true">404 und alte Browser</button><br>
        <button onclick="cmsApi(${node.id},{delete:{referer:'',source:'404'}}); this.disabled=true">404 kein Referer</button><br>
        <button onclick="cmsApi(${node.id},{delete:{bot:'1',source:'js'}}); this.disabled=true">js und Bots</button><br>
        <button onclick="cmsApi(${node.id},{delete:{unsupported_ua:'1',source:'js'}}); this.disabled=true">js und alte Browser</button><br>
        <button onclick="cmsApi(${node.id},{delete:{file:'',source:'js'}}); this.disabled=true">js kein File</button><br>
        <button onclick="cmsApi(${node.id},{delete_foreign_js:true}); this.disabled=true">js, fremd</button><br>
        <button onclick="cmsApi(${node.id},{delete:{source:'404'}}); this.disabled=true">404 löschen</button><br>
        <button onclick="cmsApi(${node.id},{delete:{source:'net'}}); this.disabled=true">net löschen</button><br>
        <button onclick="cmsApi(${node.id},{delete:{source:'perf'}}); this.disabled=true">perf löschen</button><br>
        <button onclick="cmsApi(${node.id},{delete:{prio:'notice',source:'csp'}}); this.disabled=true">csp read-only</button><br>
        <button onclick="cmsApi(${node.id},{delete:{prio:'notice'}}); this.disabled=true">Notizen</button><br>
        <button onclick="cmsApi(${node.id},{deleteAll:1}); this.disabled=true">Alle Einträge löschen</button><br>
    </div>
</div>`;

    if (!rows.length && get.show !== "entries") {
        return `<div class="beBoxCont">${tools}<div class="c1-box"><div class="-body">Super, bis jetzt keine Fehler!</div></div></div>`;
    }

    if (get.show === "entries") {
        const entriesBox = await renderEntryList(node, ctx, get);
        return `<div class="beBoxCont">${tools}${entriesBox}</div>`;
    }

    const { editorLink } = makeFileHelper(ctx);
    let tableRows = "";
    for (const row of rows) {
        const color   = ({ error: "red", warning: "orange", notice: "blue" } as any)[row.prio] ?? "black";
        const num     = Number(row.num)     || 0;
        const numBot  = Number(row.num_bot) || 0;
        const numUns  = Number(row.num_unsupported) || 0;
        const entriesUrl = `?show=entries&source=${encodeURIComponent(row.source)}&file=${encodeURIComponent(row.file)}&line=${encodeURIComponent(row.line)}&col=${encodeURIComponent(row.col)}`;
        const editorUrl  = editorLink(row.file, row.line, row.col);
        tableRows += `
<tr>
    <td style="width:3rem; white-space:nowrap">
        <a href="${hee(entriesUrl)}">${hee(String(row.num_ip))} IPs<br><small>${num} x</small></a>
    <td style="width:6rem">
        ${hee(row.source)}
        <small t1-badge style="white-space:nowrap; background-color:${color}; opacity:1">${hee(row.prio || "?")}</small><br>
        <small>bots: ${numBot}
            <div style="display:inline-block; border:1px solid; width:30px; vertical-align:middle">
                <div style="height:.6em; width:${num ? Math.round(numBot * 100 / num) : 0}%; background:currentColor"></div>
            </div>
        </small><br>
        <small>oldies: ${numUns}
            <div style="display:inline-block; border:1px solid; width:30px; vertical-align:middle">
                <div style="height:.6em; width:${num ? Math.round(numUns * 100 / num) : 0}%; background:currentColor"></div>
            </div>
        </small>
    <td>
        <a target="_blank" href="${hee(editorUrl)}">${hee(row.message)}</a><br>
        <small>${u2time(row.time)}</small>
        <div>${hee(row.usr_email ?? "")}</div>
    <td>
        <img
            onclick="cmsApi(${node.id},{delete:Object.assign({},this.dataset)})"
            data-file="${hee(row.file)}"
            data-line="${hee(String(row.line))}"
            data-col="${hee(String(row.col))}"
            src="${hee(ctx.sysURL)}cms.frontend.1/pub/img/delete.svg"
            class="-rem"
            alt="Löschen"
            style="cursor:pointer; height:20px">`;
    }

    return `
<div class="beBoxCont">
    ${tools}
    <div class="c1-box" style="max-height:88vh; overflow:auto; width:auto;">
        <div class="-head">Errors</div>
        <table class="c1-style">
            <tbody>${tableRows}
        </table>
    </div>
</div>`;
}

async function renderEntryList(node: Node, ctx: any, get: Record<string, string>): Promise<string> {
    const db = node.app.db;
    const { editorLink, fileDisplay } = makeFileHelper(ctx);

    const where = db.table("m_error_report").valuesToWhere({ source: get.source, file: get.file, line: get.line, col: get.col });
    if (!where) return "<div>Ungültige Parameter</div>";

    const rows = await db.all(
        `SELECT e.*, usr.email
         FROM m_error_report e
            LEFT JOIN log  ON e.log_id   = log.id
            LEFT JOIN sess ON log.sess_id = sess.id
            LEFT JOIN usr  ON sess.usr_id = usr.id
         WHERE ${where} ORDER BY e.time DESC LIMIT 200`
    );

    let tableRows = "";
    for (const row of rows) {
        const eUrl = editorLink(row.file ?? "", row.line, row.col);

        let btHtml = "";
        const bt = row.backtrace ? JSON.parse(row.backtrace) : [];
        for (const item of bt) {
            btHtml += `<tr>
    <td style="padding-right:1rem"><a href="${hee(editorLink(item.file ?? "", item.line, item.col))}" target="_blank">${hee(fileDisplay(item.file ?? ""))}</a>
    <td style="padding-right:1rem">${hee(item.function ?? "")}
    <td>${hee(item.args ? JSON.stringify(item.args) : "")}`;
        }

        tableRows += `
<tr style="white-space:nowrap">
    <td>
        <a href="?id=${hee(String(row.id))}">${u2time(row.time)} <br> ${hee(String(row.log_id ?? ""))}</a>
        <br><button onclick="cmsApi(${node.id},{delete:{id:'${hee(String(row.id))}'}}); this.disabled=true">delete</button>
    <td>
        <b>${hee(row.message ?? "")}</b><br>
        <a href="${hee(row.request ?? "")}" target="_blank">${hee(row.request ?? "")}</a><br>
        <a href="${hee(row.referer ?? "")}" target="_blank">${hee(row.referer ?? "")}</a><br>
        <small>${hee(row.browser ?? "")}</small>
        <br>${hee(row.ip ?? "")}
        <br>${hee(row.email ?? "")}
    <td>
        <a href="${hee(eUrl)}" target="_blank" title="${hee(row.file ?? "")}" style="color:inherit; text-decoration:none">
            ${row.sample ? `<pre style="font-size:10px; box-shadow:0 0 5px; padding:4px">${hee(row.sample)}</pre>` : "edit File"}
        </a>
    <td>${bt.length ? `<table>${btHtml}</table>` : ""}`;
    }

    return `
<div class="c1-box" style="height:88vh; overflow:auto; width:auto;">
    <div class="-head">${hee(get.file ?? "")} : ${hee(get.line ?? "")} : ${hee(get.col ?? "")}</div>
    <table class="c1-style">
        <tbody>${tableRows}
    </table>
</div>`;
}

async function renderDetail(node: Node, id: number): Promise<string> {
    const db  = node.app.db;
    const ctx = getCtx();
    const get = ctx.get as Record<string, string>;
    const { editorLink, fileDisplay } = makeFileHelper(ctx);

    const error = await db.row("SELECT * FROM m_error_report WHERE id = ?", [id]);
    if (!error) return "<div>Error-Eintrag nicht gefunden</div>";

    const log  = error.log_id ? await db.row("SELECT * FROM log WHERE id = ?", [error.log_id]) : null;
    const sess = log?.sess_id  ? await db.row("SELECT * FROM sess WHERE id = ?", [log.sess_id]) : null;
    const usr  = sess?.usr_id  ? await db.row("SELECT * FROM usr  WHERE id = ?", [sess.usr_id]) : null;

    let btHtml = "";
    const bt = error.backtrace ? JSON.parse(error.backtrace) : [];
    for (const item of bt) {
        const isLocal = urlToLocalPath(item.file ?? "", ctx) !== null;
        const fileCell = isLocal
            ? `<a href="${hee(editorLink(item.file, item.line, item.col))}" target="_blank">${hee(fileDisplay(item.file ?? ""))} <span style="opacity:.6">: ${hee(String(item.line ?? ""))}${item.col ? " : " + hee(String(item.col)) : ""}</span></a>`
            : `${hee(item.file ?? "")} <span style="opacity:.6">: ${hee(String(item.line ?? ""))}${item.col ? " : " + hee(String(item.col)) : ""}</span>`;
        btHtml += `
<tr>
    <td>${fileCell}
    <td>${hee(item.function ?? "")}
    <td>${hee(item.args ? JSON.stringify(item.args) : "")}`;
    }

    const historyOf = get.history_of ?? "ip";
    let historyWhere = "";
    if      (historyOf === "ip"     && error.ip)       historyWhere = `log.ip_id IN (SELECT id FROM log_ip WHERE ip = ${Db.quote(error.ip)})`;
    else if (historyOf === "sess"   && log?.sess_id)   historyWhere = `log.sess_id = ${Db.quote(log.sess_id)}`;
    else if (historyOf === "client" && log?.client_id) historyWhere = `log.client_id = ${Db.quote(log.client_id)}`;

    let historyRows = "";
    if (historyWhere) {
        const logs = await db.all(
            `SELECT log.*, url.url, referer.url AS referer
             FROM log
                LEFT JOIN log_url url     ON log.url_id     = url.id
                LEFT JOIN log_url referer ON log.referer_id = referer.id
             WHERE ${historyWhere} AND log.id <= ${Db.quote(error.log_id)}
             ORDER BY log.id DESC LIMIT 30`
        ).catch(() => []);

        for (const item of logs) {
            const errorItems = await db.all("SELECT * FROM m_error_report WHERE log_id = ? ORDER BY id DESC", [item.id]).catch(() => []);
            let errorLinks = "";
            for (const eItem of errorItems) {
                const active = eItem.id === error.id ? "&#x25B6;&#xFE0E;" : "";
                errorLinks += `<a style="color:red; border:1px solid; border-width:1px 0; padding:3px 0; margin-bottom:-1px; display:block" href="?id=${hee(String(eItem.id))}">${active} ${hee(eItem.message)}</a>`;
            }
            historyRows += `
<tr>
    <td>${u2time(item.time)} <br> Session: ${hee(String(item.sess_id ?? ""))} <br> Log-ID: ${hee(String(item.id))}
    <td>
        <a href="${hee(item.url ?? "")}" target="_blank">${hee(item.url ?? "")}</a><br>
        <div style="font-size:.9em; color:#aaa">${hee(item.referer ?? "")}</div>
        ${errorLinks}
    <td><div style="max-width:600px; overflow:auto">${hee(item.post ?? "")}</div>`;
        }
    }

    const historyLinks = `
<a href="?id=${id}&history_of=ip">IP</a>
${log ? `<a href="?id=${id}&history_of=sess">Session</a> | <a href="?id=${id}&history_of=client">Client</a>` : ""}`;

    const isLocalFile = urlToLocalPath(error.file ?? "", ctx) !== null;
    const fileBlock = isLocalFile
        ? `<a style="color:inherit; text-decoration:none" target="_blank" href="${hee(editorLink(error.file, error.line, error.col))}">
               <b>${hee(fileDisplay(error.file ?? ""))}</b> line: ${hee(String(error.line))} column: ${hee(String(error.col))}
               ${error.sample ? `<pre style="box-shadow:0 0 10px; padding:10px">${hee(error.sample)}</pre>` : ""}
           </a>`
        : `<b>${hee(error.file)}</b> line: ${hee(String(error.line))} column: ${hee(String(error.col))}
           ${error.sample ? `<pre style="box-shadow:0 0 10px; padding:10px">${hee(error.sample)}</pre>` : ""}`;

    return `
<div class="beBoxCont" style="font-size:.95em">
    <div class="c1-box" style="overflow:auto; width:auto; flex:0 0 auto">
        <div class="-head">Fehler</div>
        <div class="-body">
            <h2>
                <span style="color:red">${hee(error.source)} ${hee(error.prio)}:</span>
                ${hee(error.message)}
            </h2>
            ${fileBlock}
            <table class="c1-style">
                <tr><th>Message<td>${hee(error.message)}<br><small>ID ${error.id}</small>
                <tr><th>Request<td>
                    <a href="${hee(error.request ?? "")}">${hee(error.request ?? "")}</a><br>
                    <small>Referer <a href="${hee(error.referer ?? "")}">${hee(error.referer ?? "")}</a></small>
                <tr><th>Browser<td><small>${hee(error.browser ?? "")}</small>
                <tr><th>Time<td>${u2time(error.time)} <small>(Log-ID ${error.log_id ?? ""})</small>
                <tr><th>IP<td>${hee(error.ip ?? "")}
            </table>
            ${sess ? `<b>Sess</b><pre>${hee(JSON.stringify(sess, null, 2))}</pre>` : ""}
            <br>
            <button onclick="cmsApi(${node.id},{delete:{id:'${hee(String(error.id))}'}}); this.disabled=true">delete</button>
        </div>
    </div>

    <div class="c1-box" style="overflow:auto; width:auto; flex:0 0 auto">
        <div class="-head">User</div>
        <div class="-body">
            ${usr ? `<pre>${hee(JSON.stringify(usr, null, 2))}</pre>` : "(kein User)"}
        </div>
    </div>

    <div class="c1-box" style="overflow:auto; width:auto; flex:0 0 auto">
        <div class="-head">Backtrace</div>
        <table class="c1-style">
            <thead><tr><th>File<th>Function<th>Arguments
            <tbody>${btHtml}
        </table>
    </div>

    <div class="c1-box" style="overflow:auto; width:auto; flex:0 0 auto">
        <div class="-head">History</div>
        <div class="-body" style="flex-grow:0">History of: ${historyLinks}</div>
        <table class="c1-style">
            <thead><tr><th>Time / Session<th>URL / Referer<th>POST
            <tbody>${historyRows}
        </table>
    </div>
</div>`;
}

export const cms = {
  node: {
    render,
  },
};
