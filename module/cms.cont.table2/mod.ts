import type { Node } from "../cms/lib/Node.ts";
import { Output } from "../core/lib/util.ts";
import options from "./options.ts";
import api from "./nodeApi.ts";
import type { App } from "../core/server.ts";
import type { RequestContext } from "../core/lib/RequestContext.ts";

export const name = "cms.cont.table2";
export const needs = ["cms"];

export async function install({ app }: { app: App }): Promise<void> {
  const exists = await app.db.one(`SELECT name FROM module WHERE name = 'cms.cont.table2'`);
  if (!exists) await app.db.query(`INSERT INTO module SET access = '1', name = 'cms.cont.table2'`);
}

const settingsSchema = {
  additionalProperties: {
    type: "string",
    description: "Free additional setting. Column widths are stored as row_1, row_2, etc.",
  },
  properties: {
    cols: { type: "integer", minimum: 1, maximum: 15, description: "Number of table columns." },
    rows: { type: "integer", minimum: 1, maximum: 300, description: "Number of table rows." },
  },
};

async function render(node: Node, { ctx }: { ctx: RequestContext }): Promise<string> {
  if (node.edit) {
    ctx.html.scripts.add(node.modUrl + "pub/edit.mjs");
  }

  const cols = Math.min(Math.max(1, Number(node.settings.cols()) || 2), 15);
  const rows = Math.min(Math.max(1, Number(node.settings.rows()) || 2), 300);

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
    throw new Output(csv);
  }

  let html = `<div>\n  <table thm1-width>\n    <tbody>\n`;
  for (let r = 0; r < rows; r++) {
    html += `      <tr>\n`;
    for (let j = 0; j < cols; j++) {
      const T = await node.showText(`${r}_${j}`);
      let w = String(node.settings[`row_${j + 1}`]() ?? "");
      if (/^\d+$/.test(w)) w += "px";
      const styleAttr = w ? ` style="width:${w}"` : "";
      const editAttr = node.edit ? ` contenteditable cmstxt=${T.id}` : "";
      html += `        <td${styleAttr}${editAttr}>${T}\n`;
    }
  }
  html += `  </table>\n</div>`;
  return html;
}

export const cms = {
  node: {
    render,
    options,
    api,
    settingsSchema,
  },
};
