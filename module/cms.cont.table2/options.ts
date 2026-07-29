import type { Node } from "../cms/mod.ts";
import { html, type HtmlString, uid, getCtx } from "../core/mod.ts";

export default function (node: Node, _vars: unknown): Promise<HtmlString> {
  const t = node.app.t;
  const cols = Math.max(1, Number(node.settings.cols()) || 1);
  const rows = Math.max(1, Number(node.settings.rows()) || 1);
  const percent = Math.floor(100 / cols);
  const errorID = uid(7);

  const ctx = getCtx();
  const u = ctx.req.url.toURL();
  u.searchParams.set("export_table", String(node.id));
  const exportUrl = u.pathname + u.search;

  const colWidths: HtmlString[] = [];
  for (let i = 1; i <= cols; i++) {
    const val = node.settings[`row_${i}`]();
    colWidths.push(html`
    <div style="width:${percent}%; text-align:center;">
      ${i}<br>
      <input value="${val}" data-node="${node.id}" data-key="${"row_" + i}" data-table2-setting style="width:93%; text-align:center" placeholder="50%"/>
    </div>`);
  }

  return html.async`
<input type=number value="${rows}" min=1 max=300 data-node="${node.id}" data-key=rows data-table2-setting style="width:5em;">
${t`Rows (max: 300)`}<br>
<br>
<input type=number value="${cols}" min=1 max=15 data-node="${node.id}" data-key=cols data-table2-setting data-reload-options style="width:5em;">
${t`Columns (max: 15)`}<br>

<br>
<br>
<p id="${errorID}" style="color:#FF0000; display:none;">${t`Note: the sum of all column widths must equal 100%.`}</p>
<div style="display:flex">${html.join(colWidths)}</div>

<p>&nbsp;</p>
<a href="${exportUrl}">${t`Export table as Excel`}</a>`;

}
