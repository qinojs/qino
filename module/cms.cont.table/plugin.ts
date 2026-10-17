import { csv, header, hee, Output, xlsx } from "@qino/qino";

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
    header: { type: "boolean", description: "The first row labels the columns." },
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
  const order = Array.from({ length: rows }, (_, i) => node.settings.direction() ? rows - 1 - i : i);
  const colIds = Array.from({ length: cols }, (_, j) => j);
  // every cell at once: up to 300 × 15 texts
  const texts = await Promise.all(order.map((r) => Promise.all(colIds.map((j) => node.showText(`${r}_${j}`)))));

  if (ctx.req.query.export_table === String(node)) {
    const titleStr = (await node.showTitle()).plain();
    const d = new Date();
    const dateStr = `${String(d.getDate()).padStart(2, "0")}.${
      String(d.getMonth() + 1).padStart(2, "0")
    }.${String(d.getFullYear()).slice(-2)}`;
    const lines = texts.map((row) => row.map((text) => text.plain()));

    // Excel for people, CSV (?format=csv) for machines
    const asCsv = ctx.req.query.format === "csv";
    const headers = ctx.res.headers;
    const type = asCsv ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    headers.set("Content-Type", type);
    headers.set(...header.contentDisposition("attachment", `${titleStr}_${dateStr}.${asCsv ? "csv" : "xlsx"}`));
    headers.set("Cache-Control", "no-cache");
    throw new Output(asCsv ? csv(lines) : await xlsx(lines));
  }

  const widths = colIds.map((j) => cssWidth(String(node.settings[`row_${j + 1}`]() ?? ""), units));
  const row = (cells: typeof texts[number], tag: "td" | "th") => `      <tr>\n` + cells.map((text, j) => {
    const attrs = (tag === "th" ? " scope=col" : "") + (widths[j] ? ` style="width:${widths[j]}"` : "") +
      (edit ? ` contenteditable cmstxt=${text.id}` : "");
    return `        <${tag}${attrs}>${text}\n`;
  }).join("");

  const title = (await node.showTitle()).plain();
  const head = node.settings.header() ? texts.shift() : undefined;
  return `<div>\n  <table class=u2-width>\n` +
    (title ? `    <caption>${hee(title)}</caption>\n` : "") +
    (head ? `    <thead>\n${row(head, "th")}    </thead>\n` : "") +
    `    <tbody>\n${texts.map((cells) => row(cells, "td")).join("")}  </table>\n</div>`;
}

export const cms = {
  node: {
    render,
    widget: "pub/widget.js",
    api,
    settingsSchema,
  },
};
