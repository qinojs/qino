/* Which groups may see or edit this node, and whether that is inherited from a parent. */
import { html } from '@qino/pub/html.js';
import { api, t } from '@qino/pub/qino.js';

import { levelBadges, partial, row, searchable, table } from './access.js';

export { css } from './access.js';

export default async function (widget, { node, signal }) {
  const ref = api.cms.node(node.id);
  const [vs, first] = await Promise.all([
    ref.get({}, { signal }),
    ref.access.groups.get({ search: '' }, { signal }),
  ]);

  widget.head = t`Group access`;
  widget.badge = [...(vs.public ? [] : [{ text: '', class: '-icon' }]), ...levelBadges(first.rows)];

  const list = (data) => table(t`Group`, [
    row(t`Public`, 'public', vs.public ? 1 : 0),
    ...data.rows.map((r) => row(r.label, 'g_' + r.id, r.access)),
  ]);

  await widget.html`<div class=-access>
    <label><input type=checkbox class=-inherit ${first.inheritsFrom ? 'checked' : ''}> ${t`Group permissions inherited`}</label>
    ${first.inheritsFrom
      ? html.async`<div class=-from>${t`Inherited from`} ${first.inheritsFrom.title}</div>`
      : html.async`${partial(first) ? html.async`<input class=-search placeholder="${t`Search`}">` : ''}
        <div class=-rows>${list(first)}</div>`}
  </div>`;

  widget.on('change', '.-inherit', (inp) => ref.access.put({ value: inp.checked ? null : 0 }).then(() => widget.reload()));
  searchable(widget, async (search) => list(await ref.access.groups.get({ search }, { signal })));
  widget.on('change', 'input[type=radio]', (inp) => inp.name === 'public'
    ? ref.access.put({ value: Number(inp.value) ? 1 : 0 })
    : ref.access.groups(inp.name.slice(2)).put({ access: Number(inp.value) }));
}
