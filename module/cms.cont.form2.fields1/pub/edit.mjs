import { api } from '../../core/pub/js/qino.js';

const reloadOptions = () => cms.cont(cms.cont.active).showWidget('options');
const settings = node => api.cms.node(node).settings;

/** "inputs.4_1.required" → the nested api path */
const at = (node, key) => key.split('.').reduce((ref, part) => ref[part], settings(node));

document.addEventListener('input', async e => {
  const el = e.composedPath()[0];
  const input = el.closest?.('[data-fields1-setting]');
  if (!input) return;
  const value = input.type === 'checkbox' ? input.checked : input.value;
  await at(input.dataset.node, input.dataset.key).put({value});
  if (input.hasAttribute('data-reload-options')) reloadOptions();
});

document.addEventListener('click', async e => {
  const el = e.composedPath()[0];

  const add = el.closest?.('.-add[data-node]');
  if (add) {
    await settings(add.dataset.node).inputs[Date.now().toString(36)].put({value: {}});
    return reloadOptions();
  }

  const remove = el.closest?.('.-remove[data-id]');
  if (remove) {
    await settings(remove.dataset.node).inputs[remove.dataset.id].delete();
    return reloadOptions();
  }
});

/** Reorder by dragging the handle; the resulting order is stored as `sort`. */
document.addEventListener('pointerdown', e => {
  const handle = e.composedPath()[0].closest?.('.-handle');
  if (!handle) return;
  const field = handle.closest('.-field');
  const list = field.parentNode;
  e.preventDefault();

  const root = field.getRootNode(); // the options panel lives in a shadow root, which document.elementFromPoint cannot see into
  const move = ev => {
    const over = root.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('.-field');
    if (!over || over === field || over.parentNode !== list) return;
    const after = over.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_PRECEDING;
    list.insertBefore(field, after ? over.nextSibling : over);
  };
  const up = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    const sort = [...list.children].map(el => el.dataset.id).join(',');
    settings(list.dataset.node).sort.put({value: sort});
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
});
