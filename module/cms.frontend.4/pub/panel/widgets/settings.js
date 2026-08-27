/* The settings sidebar: what this node is, and the accordions that configure it. */
import { html } from '@qino/pub/html.js';
import { api, ctx, t } from '@qino/pub/qino.js';

import { widget as mount } from '../widget.js';
import { modules as moduleList } from './modules.js';

const FALLBACK_ICON = () => ctx.moduleUrl + 'cms.frontend.4/pub/img/module_default.svg';

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

export default async function (el, { node, dialogs, signal }) {
  const ref = api.cms.node(node.id);
  const [vs, modules, widgets] = await Promise.all([
    ref.get({}, { signal }),
    moduleList(),
    api['cms.frontend.4'].widgets(node.id).get({}, { signal }),
  ]);
  const parent = vs.basis ? await api.cms.node(vs.basis).get({}, { signal }).catch(() => null) : null;
  const isPage = vs.type === 'p';
  const editmode = !!globalThis.qino?.cms?.editmode;
  const icon = modules.find((m) => m.name === vs.module)?.icon;

  el.head = t`Settings`;

  await el.html`<div class=-standalone style="font-size:1.2em;margin-bottom:1em">
    <div title="Nr.${String(vs.id)}">
      <div class=-h1>
        ${isPage ? t`Page` : t`Content`}:&nbsp;
        <input ${editmode ? html.raw(`cmstxt=${vs.title_id}`) : ''} value="${vs.title}" placeholder="no title"
               style="color:inherit;background:transparent;letter-spacing:.1em;flex:1;padding:0;border:none;outline:none;font-size:inherit">
        <div style="margin-top:-.9375rem">
          <svg class=-img fill="var(--cms-dark)" width=46 height=46 style="display:block">
            <use href="${(icon ?? FALLBACK_ICON()) + '#main'}" />
          </svg>
        </div>
      </div>
      <div style="display:flex;margin-bottom:.25rem">
        <span title="${vs.module}">${isPage ? 'Layout' : 'Module'}: </span>
        <select class=-changemodule
                style="border:none;font-size:inherit;font-weight:bold;flex:1;padding:0;margin-top:-.25rem;margin-bottom:-.1875rem;background:transparent">
          ${modules.filter((m) => m.kind === (isPage ? 'layout' : 'cont') || m.name === vs.module)
            .map((m) => html`<option ${m.name === vs.module ? 'selected' : ''}>${m.name}`)}
        </select>
      </div>
    </div>
    ${parent
      ? html.async`<div class=-editparent>${t`parent:`}
          <a href="${parent.url}" style="font-weight:bold">${parent.title}${parent.type === 'c'
            ? html` ${parent.module} <span style="font-weight:normal;color:#000;font-size:20px;line-height:.5em;position:relative;margin-bottom:-.125rem">✎</span>`
            : ''}</a></div>`
      : ''}
  </div>`;

  // Every accordion below comes from the widget list: a widget module, or — until the last
  // server renderer is gone — a container the old endpoint fills.
  for (const w of widgets) {
    const h = head(w.title ?? w.name);
    h.classList.toggle('-open', !!cms.panel.widgets.has(w.name)?.get({ silent: true }));
    el.append(h);
    if (w.src) {
      const child = mount(w.src, { node: { id: node.id }, dialogs, ...w.context });
      child.className = '-content';
      child.setAttribute('widget', w.name);
      child.addEventListener('qcms-widget-head', ({ detail }) => announce(h, detail));
      el.append(child);
    } else {
      const box = document.createElement('div');
      box.className = '-content';
      box.setAttribute('widget', w.name);
      el.append(box);
      api['cms.frontend.4'].widget(w.name).post({ params: { pid: node.id } }, { signal })
        .then((res) => box.innerHTML = res);
    }
  }

  el.on('change', '.-changemodule', async (sel) => {
    await ref.module.put({ module: sel.value });
    if (isPage) return location.href = location.href.replace(/#.*$/, '');
    document.querySelector(`[qcms-id="${node.id}"]`).outerHTML = await ref.html.get();
    el.reload();
  });
  // a content parent is edited in here, a page parent is a link like any other
  el.on('click', '.-editparent', (div, e) => {
    if (parent?.type === 'p') return;
    e.preventDefault();
    cms.cont.active = parent.id;
    el.reload({ node: { id: parent.id }, dialogs });
  });
}
