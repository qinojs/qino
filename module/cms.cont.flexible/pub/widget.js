/* Flexible's own panel: the shared list, plus the one thing that belongs to the container and
   not to its entries — a container holding a single block is a wrapper nobody asked for, so it
   can step aside and let that block take its place. */
import list, { css as listCss } from './list.js';
import { html } from '@qino/pub/html.js';
import { api } from '@qino/pub/api.js';
import { t } from '@qino/pub/t.js';

export const css = listCss + `
.-items .-unwrap { width:100%; margin-top:calc(var(--rem) * .5); }
.-items .-unwrap-note { margin:calc(var(--rem) * 1) calc(var(--rem) * .25) 0; color:#999; }
`;

/** The node the container sits in — the page shows the nesting, so the dom knows it. */
const parentId = (id) =>
  document.querySelector(`[qcms-id="${id}"]`)?.parentElement?.closest('[qcms-id]')?.getAttribute('qcms-id');

export default async function (widget, context) {
  const { node, dialogs } = context;
  // Only a container with exactly one entry has something to step aside for.
  const extra = (rows) => rows.length !== 1 ? '' : html`
    <p class=-unwrap-note>${t`Replace this flexible container by its single content? No further content can be added here afterwards.`}</p>
    <button type=button class="-unwrap u2-button">${t`Replace by content`}</button>`;

  await list(widget, { ...context, extra });

  widget.on('click', '.-unwrap', async () => {
    const child = widget.querySelector('.-row')?.getAttribute('itemid');
    const parent = parentId(node.id);
    if (!child || !parent) return; // a container without a visible parent has nowhere to go
    if (!await dialogs.confirm(t`Replace by content?`)) return;
    const self = await api.cms.node(node.id).get();
    // The child takes the container's place and its name, so the parent's slot keeps its filling.
    await api.cms.node(parent)['insert-before'].put({ id: String(child), before: String(node.id) });
    if (self.name) await api.cms.node(child).patch({ name: self.name });
    await api.cms.node(node.id).delete();
    await cms.reloadNode(parent);
    cms.cont(child).showWidget('options');
  });
}
