import { debounce } from '@qino/pub/c1.js';
import { SelectorObserver } from '@qino/u2/js/SelectorObserver/SelectorObserver.js';
import { api } from '@qino/pub/api.js';

export const cms = {};

cms.modConnected = {};
const controllers = new WeakMap();

function mount(el, fn = cms.modConnected[cms.el.module(el)]) {
  if (!fn || controllers.has(el)) return;
  const ac = new AbortController();
  controllers.set(el, ac);
  fn(el, { signal: ac.signal });
}

function unmount(el) {
  const ac = controllers.get(el);
  if (!ac) return;
  ac.abort();
  controllers.delete(el);
}

export function initNode(module, fn) {
  if (cms.modConnected[module]) return;
  cms.modConnected[module] = fn;
  for (const el of document.querySelectorAll('[qcms-mod="'+module+'"]')) mount(el, fn);
}

/** Settings widgets: bind every `[setting]` field (its path in the node's settings) to
 *  `api.cms.node(id).settings`; one listener saves all. */
export const bindSettings = (el, ref) => {
  const at = (path) => path.split('.').reduce((r, key) => r[key], ref.settings);
  el.on('input', '[setting]', (inp) =>
    at(inp.getAttribute('setting')).put({ value: inp.type === 'checkbox' ? inp.checked : inp.value }));
};

cms.el = {
  root(el)   { return el.closest('[qcms-id]'); },
  nid(el)    { return cms.el.root(el)?.getAttribute('qcms-id') ?? null; },
  module(el) { return el.closest('[qcms-mod]')?.getAttribute('qcms-mod') ?? null; },
};

// api: special inputs — the combobox loads on first use, pages without such inputs never fetch it
async function abortableCombobox(input, apiFn) {
  const { Combobox } = await import('@qino/pub/qg/combobox.js');
  const box = new Combobox(input);
  let last;
  box.searchOptions = () => {
    last?.abort();
    last = new AbortController();
    apiFn({ q: input.value }, { signal: last.signal }).then(box.setOptions.bind(box));
  };
  return box;
}

document.addEventListener('focus', async e => {
  const input = e.composedPath()[0];
  if (input.tagName !== 'INPUT') return;
  let box;
  if (input.getAttribute('type') === 'qgcms-page') box = await abortableCombobox(input, api.cms.nodes.get.bind(api.cms.nodes));
  if (input.getAttribute('type') === 'qgcms-file') box = await abortableCombobox(input, api.cms.files.get.bind(api.cms.files));
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
document.body.addEventListener('input', e => { const el = e.composedPath()[0]; syncTxt(el); saveTxtDebounced(el); });

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

// global: read by scripts outside this module graph
globalThis.cms      = cms;

// last: on() runs at once for existing nodes and needs cms
new SelectorObserver({ on: el => mount(el), off: unmount }).observe('[qcms-id]');
