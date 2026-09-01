/* Which users may see or edit this node. */
import { html } from '@qino/pub/html.js';
import { api } from '@qino/pub/api.js';
import { t } from '@qino/pub/t.js';

import { levelBadges, partial, row, searchable, table } from './access.js';

export { css } from './access.js';

export default async function (widget, { node, signal }) {
  const ref = api.cms.node(node.id);

  widget.head = t`User access`;

  const rows = async (search) => {
    const { total, rows } = await ref.access.users.get({ search }, { signal });
    return { total, rows, html: await table(t`User`, rows.map((r) => row(r.label, 'u_' + r.id, r.access))) };
  };

  const first = await rows('');
  widget.badge = levelBadges(first.rows);
  await widget.html`<div class=-access>
    ${partial(first) ? html.async`<input class=-search placeholder="${t`Search`}">` : ''}
    <div class=-rows>${first.html}</div>
  </div>`;

  searchable(widget, async (search) => (await rows(search)).html);
  widget.on('change', 'input[type=radio]', (inp) =>
    ref.access.users(inp.name.slice(2)).put({ access: Number(inp.value) }));
}
