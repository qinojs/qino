import { api } from '@qino/pub/api.js';

// Submit without page reload: the api renders the node with the values as vars — same result as a
// normal POST. File uploads use the normal POST.
document.addEventListener('submit', e => {
  const form = e.target;
  const node = form.closest('[qcms-mod="cont.form2"]');
  if (!node) return;
  // File uploads and configured redirects need the browser's own submit.
  if (form.hasAttribute('data-native')) return;
  if (form.querySelector('input[type=file]')?.files.length) return;

  // the api sends its own csrf header and finds the node by url
  const vars = {};
  for (const [key, value] of new FormData(form)) {
    if (typeof value === 'string' && key !== 'qcms-node' && key !== 'csrfToken') vars[key] = value;
  }
  e.preventDefault();

  api.cms.node(node.getAttribute('qcms-id')).html.post({vars}).then(html => {
    node.outerHTML = html;
  });
});
