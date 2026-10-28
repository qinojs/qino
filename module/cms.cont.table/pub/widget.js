/* Panel widget: table size, column widths, and the excel export link. */
import { html } from '@qino/pub/html.js';
import { api } from '@qino/pub/api.js';
import { t } from '@qino/pub/t.js';

import { bindSettings } from '../../cms/pub/js/settings.js';

export const css = `
.-table .-widths { display:flex; margin-top:calc(var(--rem) * .8); }
.-table .-widths > div { flex:1; text-align:center; }
.-table .-widths input { width:93%; text-align:center; }
.-table .-export { display:block; margin-top:calc(var(--rem) * .8); }
`;

const exportUrl = (id, format) => {
  const url = new URL(location.href);
  url.searchParams.set('export_table', id);
  if (format) url.searchParams.set('format', format);
  return url.pathname + url.search;
};

export default async function (widget, { node, signal }) {
  const ref = api.cms.node(node.id);
  const settings = await ref.settings.get({}, { signal }) ?? {};
  const cols = Math.max(1, Number(settings.cols) || 1);
  const widths = Array.from({ length: cols }, (_, i) => i + 1);

  await widget.html`<div class=-table>
    <label><input type=number setting=rows min=1 max=300 value="${Math.max(1, Number(settings.rows) || 1)}" style="width:5em">
      ${t`Rows (max: 300)`}</label><br>
    <label><input type=number setting=cols class=-cols min=1 max=15 value="${cols}" style="width:5em">
      ${t`Columns (max: 15)`}</label><br>
    <label><input type=checkbox setting=header ${settings.header ? 'checked' : ''}> ${t`First row is a header`}</label>
    <div class=-widths>${widths.map((i) => html`<div>${i}<br>
      <input setting="${'width_' + i}" value="${settings['width_' + i] ?? ''}" placeholder="50%"></div>`)}</div>
    <div class=-export><a href="${exportUrl(node.id)}">${t`Export table as Excel`}</a> ·
      <a href="${exportUrl(node.id, 'csv')}">${t`as CSV`}</a></div>
  </div>`;

  bindSettings(widget, ref);
  // a different column count means different width fields
  widget.on('change', '.-cols', () => widget.reload());
}
