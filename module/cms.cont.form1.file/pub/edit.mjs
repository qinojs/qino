import { api } from '@qino/pub/qino.js';

document.addEventListener('input', e => {
  const input = e.composedPath()[0].closest?.('[data-file-setting]');
  if (!input) return;
  const value = input.type === 'checkbox' ? input.checked : input.value;
  api.cms.node(input.dataset.node).settings[input.dataset.key].put({value});
});
