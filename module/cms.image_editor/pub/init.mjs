/* Copyright (c) 2016 Tobias Buschor https://goo.gl/gl0mbf | MIT License https://goo.gl/HgajeK */
import { ctx } from '@qino/pub/qino.js';

const DBFILE = /dbFile\/[0-9]+\//; // an editable dbFile url (…/dbFile/<id>/…)

const EDIT_SVG ='<svg style="display:block; background:#fff" width="32" height="28" viewBox="0 0 32 28"><path d="M29.996 2c.002 0 .003.002.004.004v23.992c0 .002-.002.003-.004.004H2.004C2.002 26 2 25.998 2 25.996V2.004C2 2.002 2.002 2 2.004 2h27.992zM30 0H2C.9 0 0 .9 0 2v24c0 1.1.9 2 2 2h28c1.1 0 2-.9 2-2V2c0-1.1-.9-2-2-2z"/><path d="M26 7c0 1.657-1.343 3-3 3s-3-1.343-3-3 1.343-3 3-3 3 1.343 3 3zm2 17H4v-4l7-12 8 10h2l7-6z"/></svg>';

const cmsRoot = () => document.querySelector('qino-cms')?.shadowRoot;

// The chrome the editor inherits from the cms root — appended on its own, it needs it itself.
const CMS_CSS = () => ['css/norm/norm.css', 'css/base/base.css', 'class/table/table.css', 'el/ico/ico.css']
  .map(p => import.meta.resolve('@qino/u2/' + p)).concat(ctx.moduleUrl + 'cms/pub/css/ui.css');

// show the editor for an element carrying a dbFile url
const showEditor = async el => {
  const src = el.getAttribute('dbfile-editable') || el.src;
  const { DbFileImageEditor } = await import('./dbFileImageEditor.js');
  const cms = cmsRoot();
  const editor = new DbFileImageEditor();
  if (cms) {
    cms.append(editor);            // inherits the cms chrome
    editor.alert = cms.alert;      // ... and its u2 dialogs
    editor.confirm = cms.confirm;
  } else {
    for (const href of CMS_CSS()) editor.addStyle(href);
  }
  editor.show(src);
};

// ─── hover icon over editable page images (light DOM) ───────────────────────
{
  const icon = document.createElement('div');
  icon.style.cssText = 'transition:opacity .3s; border-radius:.125rem; overflow:hidden; position:absolute; z-index:1998; background:#fff; cursor:pointer';
  icon.innerHTML = EDIT_SVG;
  icon.title = 'Edit image';

  let hideTimeout;
  let iconActive = null;

  const setIconEl = el => {
    icon.style.opacity = 0;
    clearTimeout(hideTimeout);
    if (el) {
      iconActive = el;
      setTimeout(() => icon.style.opacity = 1);
      document.body.append(icon);
      const pos = el.getBoundingClientRect();
      icon.style.top  = pos.top  + scrollY + 2 + 'px';
      icon.style.left = pos.left + scrollX + 2 + 'px';
    } else {
      hideTimeout = setTimeout(() => {
        icon.remove();
        iconActive = null;
      }, 300);
    }
  };
  const testTarget = el => {
    if (!el?.getAttribute || !el.hasAttribute('dbfile-editable')) return;
    const src = el.getAttribute('dbfile-editable') || el.src;
    if (!DBFILE.test(src)) return;
    setIconEl(el);
    return el;
  };

  icon.onmouseleave = () => setIconEl(null);
  icon.onclick      = () => showEditor(iconActive);

  document.addEventListener('mouseenter', e => testTarget(e.target), true);
  document.addEventListener('mouseleave', e => {
    if (icon.contains(e.relatedTarget)) return;  // leaving into the icon?
    if (e.target !== iconActive) return;         // leaving the active el?
    if (testTarget(e.target.parentNode)) return; // is the parent a target?
    setIconEl(null);
  }, true);

  // ctrl-dblclick (hidden shortcut)
  addEventListener('dblclick', e => {
    if (!e.ctrlKey || e.target.tagName !== 'IMG') return;
    if (!DBFILE.test(e.target.src)) return;
    showEditor(e.target);
  });
}

// ─── edit column in the media list (lives in the cms panel shadow DOM) ──────
// One <td> per row (kept empty on non-images so the table columns stay aligned).
const editColumn = (tr, icon) => {
  if (tr.querySelector(':scope > .-editImage')) return;
  const td = document.createElement('td');
  td.className = '-editImage';
  td.style.cssText = 'width:1.4em; padding-inline:0; text-align:center';
  tr.lastElementChild.before(td);
  const img = tr.querySelector('.-preview img');
  if (!img || !img.src.match(/dbFile\/[0-9]+\/.*\.(jpg|jpeg|png)/i)) return;
  td.style.cursor = 'pointer';
  td.title = 'Edit image';
  td.innerHTML = icon;
  td.onclick = () => showEditor(img);
};

customElements.whenDefined('qino-cms').then(async () => {
  const root = cmsRoot();
  if (!root) return;
  const { SelectorObserver } = await import('@qino/u2/js/SelectorObserver/SelectorObserver.js');

  new SelectorObserver({ on: (tr) => editColumn(tr, '<button class=u2-unstyle title="Edit image"><u2-ico icon=edit>\u270e</u2-ico></button>') })
    .observe('.-media tr[itemid]', { root });

  // cms.frontend.2 — drop this together with that module
  new SelectorObserver({ on: (tr) => editColumn(tr, EDIT_SVG) })
    .observe('.file-manager tr[itemid]', { root });
});
