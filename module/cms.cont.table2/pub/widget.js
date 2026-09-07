/* Panel widget: table size, column widths, and the excel export link. */
import { html } from '@qino/pub/html.js';
import { api } from '@qino/pub/api.js';
import { t } from '@qino/pub/t.js';

import { bindSettings } from '../../cms/pub/js/settings.js';

export const css = `
.-table2 .-widths { display:flex; margin-top:calc(var(--rem) * .8); }
.-table2 .-widths > div { flex:1; text-align:center; }
.-table2 .-widths input { width:93%; text-align:center; }
.-table2 .-export { display:block; margin-top:calc(var(--rem) * .8); }
`;

const exportUrl = (id) => {
  const url = new URL(location.href);
  url.searchParams.set('export_table', id);
  return url.pathname + url.search;
};

export default async function (widget, { node, signal }) {
  const ref = api.cms.node(node.id);
  const settings = await ref.settings.get({}, { signal }) ?? {};
  const cols = Math.max(1, Number(settings.cols) || 1);
  const widths = Array.from({ length: cols }, (_, i) => i + 1);

  await widget.html`<div class=-table2>
    <label><input type=number setting=rows min=1 max=300 value="${Math.max(1, Number(settings.rows) || 1)}" style="width:5em">
      ${t`Rows (max: 300)`}</label><br>
    <label><input type=number setting=cols class=-cols min=1 max=15 value="${cols}" style="width:5em">
      ${t`Columns (max: 15)`}</label>
    <div class=-widths>${widths.map((i) => html`<div>${i}<br>
      <input setting="${'row_' + i}" value="${settings['row_' + i] ?? ''}" placeholder="50%"></div>`)}</div>
    <a class=-export href="${exportUrl(node.id)}">${t`Export table as Excel`}</a>
  </div>`;

  bindSettings(widget, ref);
  // a different column count means different width fields
  widget.on('change', '.-cols', () => widget.reload());
}
