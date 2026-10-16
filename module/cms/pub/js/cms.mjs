import { debounce } from '@qino/pub/c1.js';
import { SelectorObserver } from '@qino/u2/js/SelectorObserver/SelectorObserver.js';
import { Combobox } from '@qino/pub/qg/combobox.js';
import { api } from '@qino/pub/api.js';

export const cms = {};
//Object.assign(cms, c1.Eventer);

cms.modConnected = {};

cms.initNode = function(module, fn) {
  if (cms.modConnected[module]) return;
  cms.modConnected[module] = fn;
  for (const el of document.querySelectorAll('[qcms-mod="'+module+'"]')) {
    if (el.__cms_initialized) continue;
    fn(el);
    el.__cms_initialized = true;
  }
};

cms.el = {
  root(el)   { return el.closest('[qcms-id]'); },
  nid(el)    { return el.closest('[qcms-id]')?.getAttribute('qcms-id') ?? null; },
  module(el) { return el.closest('[qcms-mod]')?.getAttribute('qcms-mod') ?? null; },
};

// api: special inputs
function abortableCombobox(input, apiFn) {
  const box = new Combobox(input);
  let last;
  box.searchOptions = () => {
    last?.abort();
    last = new AbortController();
    apiFn({ q: input.value }, { signal: last.signal }).then(box.setOptions.bind(box));
  };
  return box;
}

document.addEventListener('focus', e => {
  const input = e.composedPath()[0];
  if (input.tagName !== 'INPUT') return;
  let box;
  if (input.getAttribute('type') === 'qgcms-page') box = abortableCombobox(input, api.cms.nodes.get.bind(api.cms.nodes));
  if (input.getAttribute('type') === 'qgcms-file') box = abortableCombobox(input, api.cms.files.get.bind(api.cms.files));
  box?.onfocus?.(e);
}, true);

// api: save texts
function isFormEl(el) { return el.value !== undefined && el.tagName !== 'BUTTON'; }
function cleanUpEl(el) {
  if (isFormEl(el)) return;
  el.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src');
    if (src?.startsWith(location.origin)) img.setAttribute('src', src.replace(location.origin, ''));
  });
}
function saveTxt(el) {
  if (!el?.hasAttribute?.('cmstxt')) return;
  if (!el.isContentEditable && el.form === undefined) return;
  cleanUpEl(el);
  api.cms.txt(parseInt(el.getAttribute('cmstxt'))).put({ value: isFormEl(el) ? el.value : el.innerHTML, lang: el.getAttribute('cmslang') });
}
// querySelectorAll across the document and all open shadow roots
const queryAllDeep = (selector, root = document) => [...root.querySelectorAll(selector),
  ...[...root.querySelectorAll('*')].flatMap(el => el.shadowRoot ? queryAllDeep(selector, el.shadowRoot) : [])];
// mirror the edited text into other elements showing the same text in the same language
const txtLang = el => el.getAttribute('cmslang') || document.documentElement.lang;
const txtProp = el => isFormEl(el) ? 'value' : 'innerHTML';
function syncTxt(el) {
  if (!el?.hasAttribute?.('cmstxt')) return;
  for (const other of queryAllDeep('[cmstxt="' + el.getAttribute('cmstxt') + '"]')) {
    if (other !== el && txtLang(other) === txtLang(el)) other[txtProp(other)] = el[txtProp(el)];
  }
}
// composedPath()[0] (read before debounce) finds the target inside the qino-cms shadow root too
const saveTxtDebounced = debounce(saveTxt, 1600);
document.body.addEventListener('blur', e => saveTxt(e.composedPath()[0]), true);
document.body.addEventListener('input', e => (syncTxt(e.composedPath()[0]), saveTxtDebounced(e.composedPath()[0])));

cms.reloadNode = (nid, vars) =>
  api.cms.node(nid).html.post({ vars }).then(html =>
    document.querySelectorAll('[qcms-id="' + nid + '"]').forEach(el => el.outerHTML = html)
  );

cms.reloadPart = (nid, part, vars) => {
  return api.cms.node(nid).html.part(part).post({ vars }).then(html => {
    document.querySelectorAll('[qcms-id="' + nid + '"] [cms-part="' + part + '"]').forEach(el => {
      if (el.closest('[qcms-id]').matches('[qcms-id="' + nid + '"]')) el.innerHTML = html;
    });
  });
};

// global exports for legacy scripts
globalThis.cms      = cms;

// last: on() runs at once for existing nodes and needs cms
new SelectorObserver({ on: el => {
  if (el.__cms_initialized) return;
  const module = cms.el.module(el);
  const fn = cms.modConnected[module];
  if (fn) { fn(el); el.__cms_initialized = true; }
}}).observe('[qcms-id]');
