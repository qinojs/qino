import type { Node } from "../cms/lib/Node.ts";
import { hee, uid } from "../core/lib/util.ts"
import { getCtx } from "../core/lib/RequestContext.ts";

export default async function (node: Node, _vars: unknown): Promise<string> {
  const cols = Math.max(1, Number(node.settings.cols()) || 1);
  const rows = Math.max(1, Number(node.settings.rows()) || 1);
  const percent = Math.floor(100 / cols);
  const errorID = uid(7);

  const ctx = getCtx();
  const { requestUri } = ctx;
  const exportUrl = requestUri + (requestUri.includes("?") ? "&" : "?") + `export_table=${node.id}`;

  let colWidths = "";
  for (let i = 1; i <= cols; i++) {
    const val = String(node.settings[`row_${i}`]() ?? "");
    colWidths += `
    <div style="width:${percent}%; text-align:center;">
      ${i}<br>
      <input value="${hee(val)}" data-node="${node}" data-key="${"row_" + i}" oninput="import('${ctx.sysURL}core/pub/js/apt.js').then(m=>m.apt.cms.node(this.dataset.node).defaults.put({value:{[this.dataset.key]:this.value}}))" style="width:93%; text-align:center" placeholder="50%"/>
    </div>`;
  }

  return `
<input type=number value="${hee(String(rows))}" min=1 max=300 data-node="${node}" oninput="import('${ctx.sysURL}core/pub/js/apt.js').then(m=>m.apt.cms.node(this.dataset.node).defaults.put({value:{rows:this.value}}))" style="width:80px; font-size:18px;">
${await node.app.t`Rows (max: 300)`}<br>
<br>
<input type=number value="${hee(String(cols))}" min=1 max=15 data-node="${node}" oninput="import('${ctx.sysURL}core/pub/js/apt.js').then(m=>m.apt.cms.node(this.dataset.node).defaults.put({value:{cols:this.value}})); cms.cont(cms.cont.active).showWidget('options')" style="width:80px; font-size:18px;">
${await node.app.t`Columns (max: 15)`}<br>

<br>
<br>
<p id="${errorID}" style="color:#FF0000; display:none;">${await node.app.t`Note: the sum of all column widths must equal 100%.`}</p>
<div style="display:flex">${colWidths}
</div>

<p>&nbsp;</p>
<a href="${hee(exportUrl)}">${await node.app.t`Export table as Excel`}</a>`;
}
