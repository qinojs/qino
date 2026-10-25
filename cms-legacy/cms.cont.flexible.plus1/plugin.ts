import { html } from "@qino/qino";

import type { Node } from "@qino/qino/cms";

const settingsSchema = {
  properties: {
    type: { type: "string", enum: ["flex", "grid"], default: "flex" },
    "items width": { type: "string", default: "auto", description: "Width of each item; a bare number is px." },
    "items max-width": { type: "string", description: "A bare number is px." },
    gap: { type: "string", description: "Space between the items; a bare number is px." },
    "align horizontal": { type: "string", enum: ["", "start", "center", "end"] },
  },
};

/** CSS lengths as PHP read them: a bare number is px, anything else stays — but nothing that ends
 *  the style it is written into. */
const length = (v: unknown) => {
  const s = String(v ?? "").trim().replace(/[;{}<>"]/g, "");
  return /^\d+(\.\d+)?$/.test(s) ? s + "px" : s;
};

/** Its contents side by side, as flex or grid, with width and gap of the items. */
async function render(node: Node) {
  const s = node.settings;
  let conts = await node.conts();
  if (!conts.length && !await s.type) conts = [await node.cont("", "cms.cont.text")];
  const type = await s.type === "grid" ? "grid" : "flex";
  let style = `display:${type};`, items = "";
  const width = length(await s["items width"] ?? "auto");
  if (width) type === "grid" ? style += `grid-template-columns: repeat(auto-fill, minmax(${width}, 1fr) );` : items += `width:${width};`;
  const max = length(await s["items max-width"]);
  if (max) items += `max-width:${max};`;
  const gap = length(await s.gap);
  if (gap) {
    if (type === "grid") style += `grid-gap:${gap};`;
    else {
      const [, value, unit] = gap.match(/^([^a-z]*)([a-z]*)/) ?? [];
      style += `margin:0 0 -${value}${unit} -${value}${unit};`;
      items += `margin: 0 0 ${value}${unit} ${value}${unit};`;
    }
  }
  const justify = await s["align horizontal"];
  if (["start", "center", "end"].includes(String(justify))) style += `justify-content:${justify};`;
  return html.async`<div style="${style}"><style>#container [qcms-id="${node.id}"] > * { ${html.raw(items)} }</style>${conts.map((c) => c.html())}</div>`;
}

export const cms = { node: { render, settingsSchema, css: ["pub/main.css"] } };
