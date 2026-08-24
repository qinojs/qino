/* When a node is online. Each edge is either inherited (null), unlimited (0) or a moment. */
import { html } from '@qino/pub/html.js';
import { api, t } from '@qino/pub/qino.js';

export const css = `
.-onlineTime > div { display:flex; flex-wrap:wrap; align-items:baseline; margin:0 -.4em; }
.-onlineTime > div > div { margin:.2em .4em; }
.-onlineTime .-label { flex:0 1 8em; }
.-onlineTime .-btns { display:inline-flex; white-space:nowrap; gap:1px; }
.-onlineTime .-btns > * { border-radius:0; margin:0 -.5px; }
`;

const local = (ts) => ts ? new Date(ts * 1000).toISOString().slice(0, 16) : '';

export default async function (el, { node, signal }) {
  const ref = api.cms.node(node.id);
  const vs = await ref.get({}, { signal });
  const edges = [['onlineStart', t`from`], ['onlineEnd', t`until`]];

  el.head = t`Schedule`;
  el.badge = vs.online ? '' : '!';

  const edge = (field, label) => html.async`<div>
    <div class=-label>${t`visible`} ${label}:</div>
    <div class=-btns edge=${field}>
      <button class=-always ${vs[field] === 0 ? 'disabled' : ''}>${t`unlimited`}</button>
      <button class=-inherit ${vs[field] === null ? 'disabled' : ''}>${t`inherited`}</button>
      <button class=-now>${t`scheduled`}</button>
      <input type=datetime-local value="${local(vs[field])}" required>
    </div>
  </div>`;

  await el.html`<div class=-onlineTime>${edges.map(([f, l]) => edge(f, l))}</div>`;

  const set = (inner, value) => {
    ref.patch({ [inner.closest('[edge]').getAttribute('edge')]: value });
    el.reload();
  };
  el.on('click', '.-always', (b) => set(b, '0'));
  el.on('click', '.-inherit', (b) => set(b, ''));
  el.on('click', '.-now', (b) => set(b, String(Math.ceil(Date.now() / 1000))));
  el.on('focusout', 'input', (i) => set(i, i.value)); // blur does not bubble
}
