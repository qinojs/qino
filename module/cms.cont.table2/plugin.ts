import { WRITE, type Node } from "../cms/mod.ts";
import { Output, contentDisposition, type Ctx } from "../core/mod.ts";
import options from "./options.ts";
import api from "./nodeApi.ts";

export const name = "cms.cont.table2";
export const needs = ["cms"];

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

/** Column width: a bare number becomes px, an explicit CSS length passes through, anything else is dropped. */
function cssWidth(raw: string): string {
  const w = raw.trim();
  if (/^\d+(\.\d+)?$/.test(w)) return w + "px";
  return /^\d+(\.\d+)?(px|%|em|rem)$/.test(w) ? w : "";
}

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<string> {
  if (node.edit) {
    ctx.res.html.scripts.add(node.modUrl + "pub/edit.mjs");
  }

  const cols = Math.min(Math.max(1, Number(node.settings.cols()) || 2), 15);
  const rows = Math.min(Math.max(1, Number(node.settings.rows()) || 2), 300);

  if (
    ctx.req.query.export_table && String(ctx.req.query.export_table) === String(node)
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

    const headers = ctx.res.headers;
    headers.set("Content-Type", "application/x-msdownload");
    headers.set("Content-Disposition", contentDisposition("inline", `${titleStr}_${dateStr}.xls`));
    headers.set("Expires", "0");
    headers.set("Cache-Control", "must-revalidate, post-check=0, pre-check=0");
    headers.set("Pragma", "public");
    throw new Output(csv);
  }

  let html = `<div>\n  <table thm1-width>\n    <tbody>\n`;
  for (let r = 0; r < rows; r++) {
    html += `      <tr>\n`;
    for (let j = 0; j < cols; j++) {
      const T = await node.showText(`${r}_${j}`);
      const w = cssWidth(String(node.settings[`row_${j + 1}`]() ?? ""));
      const styleAttr = w ? ` style="width:${w}"` : "";
      const editAttr = node.edit ? ` contenteditable cmstxt=${T.id}` : "";
      html += `        <td${styleAttr}${editAttr}>${T}\n`;
    }
  }
  html += `  </table>\n</div>`;
  return html;
}

export const cms = {
  access: WRITE,
  node: {
    render,
    options,
    api,
    settingsSchema,
  },
};
