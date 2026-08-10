import { api } from '@qino/pub/qino.js';

// Submit without leaving the page: the api renders the same node with the entered values as vars,
// so the result is byte-identical to the JS-free POST. File uploads stay on the native path.
document.addEventListener('submit', e => {
  const form = e.target;
  const node = form.closest('[qcms-mod="cont.form2"]');
  if (!node) return;
  // File uploads and configured redirects need the browser's own submit.
  if (form.hasAttribute('data-native')) return;
  if (form.querySelector('input[type=file]')?.files.length) return;

  // the api carries its own csrf header and addresses the node by url — send the same vars the server strips
  const vars = {};
  for (const [key, value] of new FormData(form)) {
    if (typeof value === 'string' && key !== 'qcms-node' && key !== 'csrfToken') vars[key] = value;
  }
  e.preventDefault();

  api.cms.node(node.getAttribute('qcms-id')).html.post({vars}).then(html => {
    node.outerHTML = html;
  });
});
