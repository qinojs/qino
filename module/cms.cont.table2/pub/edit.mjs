import { api } from '@qino/pub/qino.js';
import { TableHandles } from '@qino/pub/c1/tableHandles.mjs';

const handles = new TableHandles();
let active, pid;
document.addEventListener('input', e => {
  const input = e.composedPath()[0].closest('[data-table2-setting]');
  if (!input) return;
  api.cms.node(input.dataset.node).settings[input.dataset.key].put({value:input.value}).then(() => {
    if (input.hasAttribute('data-reload-options')) cms.cont(cms.cont.active).showWidget('options');
  });
});
document.documentElement.addEventListener('focus', e => {
  const el = e.target.closest('[qcms-mod="cont.table2"] > table > tbody > tr > td');
  if (!el) return;
  active = el;
  handles.showTd(active);
  pid = cms.el.nid(active);
}, true);
document.addEventListener('blur', () => handles.hide(), true);
const ACTIONS = {
  rowRemove: () => ({do:'rowRem',      row: active.parentNode.rowIndex}),
  rowAdd:    () => ({do:'rowAddAfter', row: active.parentNode.rowIndex}),
  colRemove: () => ({do:'colRem',      col: active.cellIndex}),
  colAdd:    () => ({do:'colAddRight', col: active.cellIndex}),
};
for (const [key, data] of Object.entries(ACTIONS)) {
  handles[key].addEventListener('click', () => {
    document.activeElement.blur();
    api.cms.node(pid).api.post(data()).then(() => cms.reloadNode(pid));
  });
}

cms.initNode('cont.table2', function(el) {
  el.addEventListener('paste', e => {
    if (!e.clipboardData.types.includes('text/html')) return;
    let html = e.clipboardData.getData('text/html');
    html = html.replace(/([\s\S]*)<body>/, '').replace(/<\/body>([\s\S]*)/, '');
    html = html.replace('<!--StartFragment-->', '').replace('<!--EndFragment-->', '');
    const table = c1.dom.el(html);
    if (table && table.tagName !== 'TABLE') return;
    e.preventDefault(); // not working!
    setTimeout(() => {
      let targetTd = e.target.closest('[qcms-id] > table > * > tr > td');
      const startCellIndex = targetTd.cellIndex;
      for (const tbody of table.children) {
        for (const tr of tbody.children) {
          for (const td of tr.children) {
            targetTd.innerHTML = td.innerHTML;
            onPasteFormatNode(targetTd);
            targetTd.dispatchEvent(new Event('blur', {bubbles:true, cancelable:true}));
            targetTd.blur();
            if (!targetTd.nextElementSibling) break;
            targetTd = targetTd.nextElementSibling;
          }
          const targetTr = targetTd.parentNode.nextElementSibling;
          if (!targetTr) break;
          targetTd = targetTr.children[startCellIndex];
        }
      }
    }, 0);
  });
});
