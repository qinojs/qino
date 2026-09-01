/* When a node is online. Each edge is either inherited (null), unlimited (0) or a moment. */
import { html } from '@qino/pub/html.js';
import { api, t } from '@qino/pub/qino.js';

export const css = `
.-onlineTime > div { display:flex; flex-wrap:wrap; align-items:baseline; margin:.5rem 0; }
.-onlineTime .-label { flex:0 1 8em; }
`;

// unix seconds ↔ the local-time string a datetime-local input speaks
const toLocal = (ts) => new Date((ts - new Date(ts * 1000).getTimezoneOffset() * 60) * 1000).toISOString().slice(0, 16);
const toTs = (v) => String(Math.floor(new Date(v).getTime() / 1000));

export default async function (widget, { node, signal }) {
  const ref = api.cms.node(node.id);
  const vs = await ref.get({}, { signal });
  const edges = [['onlineStart', t`from`], ['onlineEnd', t`until`]];

  widget.head = t`Schedule`;
  widget.badge = vs.online ? '' : '!';

  const edge = (field, label) => html.async`<div>
    <div class=-label>${t`visible`} ${label}:</div>
    <u2-buttongroup data-edge=${field}>
      <button class=-always ${vs[field] === 0 ? 'disabled' : ''}>${t`unlimited`}</button>
      <button class=-inherit ${vs[field] === null ? 'disabled' : ''}>${t`inherited`}</button>
      ${vs[field] ? html`<input type=datetime-local value="${toLocal(vs[field])}" required>` : html`<button class=-now>${t`scheduled`}</button>`}
    </u2-buttongroup>
  </div>`;

  await widget.html`<div class=-onlineTime>${edges.map(([f, l]) => edge(f, l))}</div>`;

  const set = (inner, value) => {
    ref.patch({ [inner.closest('[data-edge]').dataset.edge]: value });
    widget.reload();
  };
  widget.on('click', '.-always', (b) => set(b, '0'));
  widget.on('click', '.-inherit', (b) => set(b, ''));
  widget.on('click', '.-now', (b) => set(b, String(Math.ceil(Date.now() / 1000))));
  widget.on('focusout', 'input', (i) => set(i, toTs(i.value))); // blur does not bubble
}
