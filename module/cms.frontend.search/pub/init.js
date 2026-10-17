import { html } from '@qino/pub/html.js';
import { ctx } from '@qino/pub/qino.js';
import { t } from '@qino/pub/t.js';

// Reuse the panel's own initialization and widget kernel, including their shadow root.
await import(ctx.moduleUrl + 'cms.frontend/pub/panel/panel.js');
const { widget } = await import(ctx.moduleUrl + 'cms.frontend/pub/panel/widget.js');
const { onShortcut } = await import(ctx.moduleUrl + 'cms.frontend/pub/js/shortcut.js');

const NAME = 'cms.frontend.search';
const root = cms.panelRoot;
const panel = root.getElementById('panel');
const sidebar = panel.querySelector(':scope > .-sidebar');
const item = document.createElement('div');
item.className = '-item';
item.setAttribute('itemid', NAME);
item.innerHTML = await html.async`<div class=-content></div>
  <div class=-title><div class=-text title="${t`Search`} (K)">${t`Search`}</div></div>`;
item.firstElementChild.append(widget(new URL('./widget.js', import.meta.url).href, { node: { id: globalThis.qino.cms.nodeId } }));
sidebar.querySelector('.-sensor').before(item);

// The panel delegates sidebar clicks and persists the selection for every itemid.
if (cms.panel.sidebar.value === NAME) {
  item.classList.add('-open');
  panel.classList.add('-open');
}
cms.panel.sidebar.addEventListener('set', ({ value }) => {
  if (value === NAME) item.querySelector('input')?.focus();
});
onShortcut((key, event) => {
  if (key !== 'k') return;
  event.preventDefault();
  panel.classList.add('-sidebar-open');
  cms.panel.sidebar.set(NAME);
  item.querySelector('input')?.focus();
});
