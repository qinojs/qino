// Port of cms.cont.table2/index.php
import type { Node } from "../cms/lib/Node.ts";
import { OutputError } from "../core/lib/util.ts";
import options from "./options.ts";
import pageApi from "./page_api.ts";

export const name = "cms.cont.table2";
export const needs = ["cms"];

// Port of cms.cont.table2/install.php
export async function install({ app }: any): Promise<void> {
  const exists = await app.db.one(`SELECT name FROM module WHERE name = 'cms.cont.table2'`);
  if (!exists) await app.db.query(`INSERT INTO module SET access = '1', name = 'cms.cont.table2'`);
}

const settingsSchema = {
  additionalProperties: {
    type: "string",
    description: "Freies Zusatz-Setting. Spaltenbreiten werden z.B. als row_1, row_2 usw. gespeichert.",
  },
  properties: {
    cols: { type: "integer", minimum: 1, maximum: 15, description: "Anzahl der Tabellenspalten." },
    rows: { type: "integer", minimum: 1, maximum: 300, description: "Anzahl der Tabellenzeilen." },
  },
};

async function render(node: Node, { ctx }: any): Promise<string> {
  if (node.edit) {
    ctx.html.addJSM(node.modUrl + "pub/edit.mjs");
  }

  const cols = Math.min(Math.max(1, parseInt(String(await node.settings.cols)) || 2), 15);
  const rows = Math.min(Math.max(1, parseInt(String(await node.settings.rows)) || 2), 300);

  if (
    ctx.get["export_table"] && String(ctx.get["export_table"]) === String(node)
  ) {
    const titleStr = String(await node.showTitle());
    const d = new Date();
    const dateStr = `${String(d.getDate()).padStart(2, "0")}.${
      String(d.getMonth() + 1).padStart(2, "0")
    }.${String(d.getFullYear()).slice(-2)}`;

    const lines: string[] = [];
    for (let r = 0; r < rows; r++) {
      const row: string[] = [];
      for (let j = 0; j < cols; j++) {
        const text = String(await node.showText(`${r}_${j}`)).replace(/<[^>]*>/g, "");
        row.push(text);
      }
      lines.push(row.map((f) => `"${f.replace(/"/g, '""')}"`).join(","));
    }
    const csv = lines.join("\r\n");

    ctx.responseHeaders.set("Content-Type", "application/x-msdownload");
    ctx.responseHeaders.set(
      "Content-Disposition",
      `inline; filename="${titleStr}_${dateStr}.xls"`,
    );
    ctx.responseHeaders.set("Expires", "0");
    ctx.responseHeaders.set("Cache-Control", "must-revalidate, post-check=0, pre-check=0");
    ctx.responseHeaders.set("Pragma", "public");
    throw new OutputError(csv);
  }

  let html = `<div>\n\t<table thm1-width>\n\t\t<tbody>\n`;
  for (let r = 0; r < rows; r++) {
    html += `\t\t\t<tr>\n`;
    for (let j = 0; j < cols; j++) {
      const T = await node.showText(`${r}_${j}`);
      let w = String(await node.settings[`row_${j + 1}`] ?? "");
      if (/^\d+$/.test(w)) w = w + "px";
      const styleAttr = w ? ` style="width:${w}"` : "";
      const editAttr = node.edit ? ` contenteditable cmstxt=${T.id}` : "";
      html += `\t\t\t\t<td${styleAttr}${editAttr}>${T}\n`;
    }
  }
  html += `\t</table>\n</div>`;
  return html;
}

export const cms = {
  node: {
    render,
    options,
    pageApi,
    settingsSchema,
  },
};
