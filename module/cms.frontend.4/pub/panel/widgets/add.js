/* Module picker: the content blocks that can be added here, plus saved templates. */
import { html } from '@qino/pub/html.js';
import { api, ctx, t } from '@qino/pub/qino.js';

import { modules as moduleList } from './modules.js';

const FALLBACK = () => ctx.moduleUrl + 'cms.frontend.4/pub/img/module_default.svg';

const label = (name) => {
  const short = name.replace('cms.cont.', '').replace(/\./g, ' ');
  return short.charAt(0).toUpperCase() + short.slice(1);
};

const svg = (icon) => html`<svg class=-img aria-hidden=true><use href="${(icon ?? FALLBACK()) + '#main'}"></svg>`;

/** Template ids come from the user's own list and the app default. */
async function templates(signal) {
  const own = await api.core['ctx-settings']('cms', 'models').get({}, { signal }).catch(() => '');
  const ids = [...new Set(String(own ?? '').split(',').map((v) => v.trim()).filter(Boolean))];
  const nodes = await Promise.all(ids.map((id) => api.cms.node(id).get({}, { signal }).catch(() => null)));
  return nodes.filter((n) => n && n.type === 'c' && n.myaccess >= 2);
}

export default async function (el, { signal }) {
  const [modules, models] = await Promise.all([
    moduleList(),
    templates(signal),
  ]);
  const icons = Object.fromEntries(modules.map((m) => [m.name, m.icon]));
  const conts = modules.filter((m) => m.kind === 'cont' && m.name !== 'cms.cont.flexible');

  await el.html`<div class="-add -standalone">
    <div class=-h1>
      <span>${t`Modules`}</span>
      <input class=-search placeholder="${t`Search`}..." style="width:50%">
    </div>
    <div class="add-modules -module-boxes">
      ${conts.map((m) => html`<div itemid="${m.name}" title="${m.description}">
        <div class=-title title="${m.name}">${label(m.name)}</div>
        ${svg(m.icon)}
      </div>`)}
    </div>
    ${models.length ? html.async`
      <div class=-standalone><br><br><div class=-h1><span>Templates</span></div></div>
      <div class="add-models -module-boxes">
        ${models.map((n) => html`<div itemid="${n.id}">
          ${svg(icons[n.module])}
          <div class=-title title="${n.id}">${n.title}</div>
        </div>`)}
      </div>` : ''}
  </div>`;

  el.querySelector('.-search').focus();
  el.on('input', '.-search', (inp) => {
    const q = inp.value.toLowerCase();
    for (const b of el.querySelectorAll('.-module-boxes > *')) {
      b.style.display = b.textContent.toLowerCase().includes(q) ? 'flex' : 'none';
    }
  });

  el.on('mousedown', '.-module-boxes > [itemid]', async (b, e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const { default: loading } = await import('@qino/pub/c1/loading.mjs');
    loading.mark(b);
    const id = b.getAttribute('itemid');
    if (b.closest('.add-models')) {
      const { id: copy } = await api.cms.node(id).copy.post();
      cms.panel.sidebar.set('');
      cms.cont(copy).addPosition();
    } else {
      cms.cont.add(id);
    }
  });
}
