import { Output, header } from "@qino/qino";

import options from "./options.ts";
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

/** Column width: a bare number takes the `units` setting (px unless told otherwise), an explicit CSS
 *  length passes through, anything else is dropped. */
function cssWidth(raw: string, units: string): string {
  const w = raw.trim();
  if (/^\d+(\.\d+)?$/.test(w)) return w + units;
  return /^\d+(\.\d+)?(px|%|em|rem)$/.test(w) ? w : "";
}

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<string> {
  if (node.edit) ctx.res.html.scripts.add(node.modUrl + "pub/edit.mjs");

  const cols = Math.min(Math.max(1, Number(node.settings.cols()) || 2), 15);
  const rows = Math.min(Math.max(1, Number(node.settings.rows()) || 2), 300);
  const units = node.settings.units() === "%" ? "%" : "px";
  const bottomUp = !!node.settings.direction();

  if (
    ctx.req.query.export_table && ctx.req.query.export_table === String(node)
  ) {
    const titleStr = String(await node.showTitle());
    const d = new Date();
    const dateStr = `${String(d.getDate()).padStart(2, "0")}.${
      String(d.getMonth() + 1).padStart(2, "0")
    }.${String(d.getFullYear()).slice(-2)}`;

    const lines = [];
    for (let i = 0; i < rows; i++) {
      const r = bottomUp ? rows - 1 - i : i;
      const row = [];
      for (let j = 0; j < cols; j++) {
        const text = String(await node.showText(`${r}_${j}`)).replace(/<[^>]*>/g, "");
        row.push(text);
      }
      lines.push(row.map((f) => `"${f.replace(/"/g, '""')}"`).join(","));
    }
    const csv = lines.join("\r\n");

    const headers = ctx.res.headers;
    headers.set("Content-Type", "application/x-msdownload");
    headers.set(...header.contentDisposition("inline", `${titleStr}_${dateStr}.xls`));
    headers.set("Cache-Control", "no-cache");
    throw new Output(csv);
  }

  let html = `<div>\n  <table thm1-width>\n    <tbody>\n`;
  for (let i = 0; i < rows; i++) {
    const r = bottomUp ? rows - 1 - i : i;
    html += `      <tr>\n`;
    for (let j = 0; j < cols; j++) {
      const text = await node.showText(`${r}_${j}`);
      const w = cssWidth(String(node.settings[`row_${j + 1}`]() ?? ""), units);
      const styleAttr = w ? ` style="width:${w}"` : "";
      const editAttr = node.edit ? ` contenteditable cmstxt=${text.id}` : "";
      html += `        <td${styleAttr}${editAttr}>${text}\n`;
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
