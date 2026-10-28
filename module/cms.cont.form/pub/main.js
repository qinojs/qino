import { api } from '@qino/pub/api.js';

// Submit without page reload: the api renders the node with the values as vars — same result as a
// normal POST. File uploads use the normal POST, and so does a send the api could not take.
document.addEventListener('submit', e => {
  const form = e.target;
  const node = form.closest('[qcms-mod="cont.form"]');
  if (!node) return;
  // File uploads and configured redirects need the browser's own submit.
  if (form.hasAttribute('data-native')) return;
  if ([...form.querySelectorAll('input[type=file]')].some(input => input.files.length)) return;

  // the api sends its own csrf header and finds the node by url
  // a name sent more than once keeps all its values, as in a normal POST
  const vars = {};
  for (const [key, value] of new FormData(form)) {
    if (typeof value !== 'string' || key === 'qcms-node' || key === 'csrfToken') continue;
    vars[key] = Object.hasOwn(vars, key) ? [vars[key]].flat().concat(value) : value;
  }
  e.preventDefault();
  form.inert = true; // one entry per click

  api.cms.node(node.getAttribute('qcms-id')).html.post({vars})
    .then(html => node.outerHTML = html)
    .catch(() => { form.inert = false; form.submit(); });
});
