import { csv, header, Output, xlsx } from "@qino/qino";

import api from "./nodeApi.ts";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const settingsSchema = {
  additionalProperties: {
    type: "string",
    description: "Free additional setting. Column widths are stored as row_1, row_2, etc.",
  },
  properties: {
    cols: { type: "integer", minimum: 1, maximum: 15, description: "Number of table columns." },
    rows: { type: "integer", minimum: 1, maximum: 300, description: "Number of table rows." },
    units: { type: "string", enum: ["px", "%"], description: "Unit of a bare column width." },
    direction: { type: "boolean", description: "Renders the rows bottom-up." },
  },
};

/** Column width: a number uses the `units` setting (default px), a CSS length stays, else dropped. */
function cssWidth(raw: string, units: string) {
  const w = raw.trim();
  if (/^\d+(\.\d+)?$/.test(w)) return w + units;
  return /^\d+(\.\d+)?(px|%|em|rem)$/.test(w) ? w : "";
}

async function render(node: Node, { ctx }: { ctx: Ctx }) {
  const edit = await node.edit();
  if (edit) ctx.res.html.scripts.add(node.modUrl + "pub/edit.mjs");

  const cols = Math.min(Math.max(1, Number(node.settings.cols()) || 2), 15);
  const rows = Math.min(Math.max(1, Number(node.settings.rows()) || 2), 300);
  const units = node.settings.units() === "%" ? "%" : "px";
  const bottomUp = !!node.settings.direction();

  if (ctx.req.query.export_table === String(node)) {
    const titleStr = (await node.showTitle()).plain();
    const d = new Date();
    const dateStr = `${String(d.getDate()).padStart(2, "0")}.${
      String(d.getMonth() + 1).padStart(2, "0")
    }.${String(d.getFullYear()).slice(-2)}`;

    const lines = [];
    for (let i = 0; i < rows; i++) {
      const r = bottomUp ? rows - 1 - i : i;
      const row = [];
      for (let j = 0; j < cols; j++) row.push((await node.showText(`${r}_${j}`)).plain());
      lines.push(row);
    }

    // Excel for people, CSV (?format=csv) for machines
    const asCsv = ctx.req.query.format === "csv";
    const headers = ctx.res.headers;
    const type = asCsv ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    headers.set("Content-Type", type);
    headers.set(...header.contentDisposition("attachment", `${titleStr}_${dateStr}.${asCsv ? "csv" : "xlsx"}`));
    headers.set("Cache-Control", "no-cache");
    throw new Output(asCsv ? csv(lines) : await xlsx(lines));
  }

  let html = `<div>\n  <table class=u2-width>\n    <tbody>\n`;
  for (let i = 0; i < rows; i++) {
    const r = bottomUp ? rows - 1 - i : i;
    html += `      <tr>\n`;
    for (let j = 0; j < cols; j++) {
      const text = await node.showText(`${r}_${j}`);
      const w = cssWidth(String(node.settings[`row_${j + 1}`]() ?? ""), units);
      const styleAttr = w ? ` style="width:${w}"` : "";
      const editAttr = edit ? ` contenteditable cmstxt=${text.id}` : "";
      html += `        <td${styleAttr}${editAttr}>${text}\n`;
    }
  }
  html += `  </table>\n</div>`;
  return html;
}

export const cms = {
  node: {
    render,
    widget: "pub/widget.js",
    api,
    settingsSchema,
  },
};
