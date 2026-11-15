/* The settings sidebar: what this node is, and the accordions that configure it. */
import { html, unhee } from '@qino/pub/html.js';
import { api } from '@qino/pub/api.js';
import { t } from '../../js/t.js';
import { ctx } from '@qino/pub/qino.js';

import { widget as mount } from '../widget.js';
import { modules as moduleList, shortName } from './modules.js';

const FALLBACK_ICON = () => ctx.moduleUrl + 'cms.frontend/pub/img/module_default.svg';

/** The panel's accordion head. The widget fills in title and badges as it announces them. */
function head(title) {
  const el = document.createElement('div');
  el.className = '-widgetHead';
  el.innerHTML = '<span class=-title></span>';
  el.firstElementChild.textContent = title;
  return el;
}

function announce(head, { head: title, badge }) {
  if (title) head.firstElementChild.textContent = title;
  for (const old of head.querySelectorAll('.-info')) old.remove();
  for (const b of Array.isArray(badge) ? badge : [{ text: badge }]) {
    if (!b?.text && b?.text !== 0) continue;
    const info = document.createElement('span');
    info.className = '-info' + (b.class ? ' ' + b.class : '');
    info.textContent = b.text;
    head.append(info);
  }
}

export default async function (widget, { node, dialogs, signal }) {
  const ref = api.cms.node(node.id);
  const [vs, modules, widgets, edits] = await Promise.all([
    ref.get({}, { signal }),
    moduleList(),
    api['cms.frontend'].widgets(node.id).get({}, { signal }),
    api['cms.frontend'].edits(node.id).get({}, { signal }), // backend pages that edit it
  ]);
  const parent = vs.basis ? await api.cms.node(vs.basis).get({}, { signal }).catch(() => null) : null;
  const isPage = vs.type === 'p';
  const editmode = globalThis.qino?.cms?.editmode;
  const icon = modules.find((m) => m.name === vs.module)?.icon;

  widget.head = t`Settings`;

  await widget.html`<div class=-standalone style="font-size:1.2em;margin-bottom:1em">
    <div style="display:grid;grid-template-columns:auto 1fr; gap:.4em; align-items: baseline;">
      <h1 style="margin:0">${isPage ? t`Page` : t`Content`}:</h1>
      <div style="display:flex;">
        <input ${editmode ? html.raw(`cmstxt=${vs.title_id}`) : ''} value="${unhee(vs.title)}" placeholder="no title"
              class=u2-unstyle style="flex:1;font-size:1.2em">
        <svg class=-img fill="var(--cms-dark)" width=46 height=46 style="margin-top:-.9em">
          <use href="${(icon ?? FALLBACK_ICON()) + '#main'}" />
        </svg>
      </div>

      <span title="${vs.module}">${isPage ? 'Layout' : t`Module`}:</span>
      <select class="-changemodule u2-unstyle" style="font-size:inherit;font-weight:bold;">
        ${!vs.module || modules.some((m) => m.name === vs.module) ? '' : html`<option value="${vs.module}" selected>${shortName(vs.module)}`}
        ${modules.filter((m) => m.kind === (isPage ? 'layout' : 'cont') || m.name === vs.module)
          .map((m) => html`<option value="${m.name}" ${m.name === vs.module ? 'selected' : ''}>${shortName(m.name)}`)}
      </select>

      ${parent
        ? html.async`<span>${t`Parent:`}</span>
            <a class=-editparent href="${parent.url}" style="font-weight:bold;">${parent.title}${parent.type === 'c'
              ? html` ${shortName(parent.module)} <u2-ico inline icon=edit>✎</u2-ico>`
              : ''}</a>`
        : ''}
      ${edits.map((e) => html`<a href="${e.url}" style="grid-column: span 2; font-weight:bold">${e.title} <u2-ico inline icon=edit>✎</u2-ico></a>`)}
    </div>
  </div>`;

  // Every accordion below is a widget module named by the list.
  for (const w of widgets) {
    const h = head(w.title ?? w.name);
    h.classList.toggle('-open', !!cms.panel.widgets.has(w.name)?.get({ silent: true }));
    widget.append(h);
    const child = mount(w.src, { node: { id: node.id }, dialogs, ...w.context });
    child.className = '-content';
    child.setAttribute('widget', w.name);
    child.addEventListener('qcms-widget-head', ({ detail }) => announce(h, detail));
    widget.append(child);
  }

  widget.on('change', '.-changemodule', async (sel) => {
    await ref.module.put({ module: sel.value });
    if (isPage) return location.href = location.href.replace(/#.*$/, '');
    widget.reload(); // the block itself is reloaded by inline.js on PUT module
  });
  // a content parent is edited in here, a page parent is a link like any other
  widget.on('click', '.-editparent', (_, e) => {
    if (parent?.type === 'p') return;
    e.preventDefault();
    cms.cont.active = parent.id;
    widget.reload({ node: { id: parent.id }, dialogs });
  });
}
