import { api } from '../../core/pub/js/qino.js';

document.addEventListener('input', e => {
  const input = e.composedPath()[0].closest?.('[data-file-setting]');
  if (!input) return;
  const value = input.type === 'checkbox' ? input.checked : input.value;
  api.cms.node(input.dataset.node).settings[input.dataset.key].put({value});
});
