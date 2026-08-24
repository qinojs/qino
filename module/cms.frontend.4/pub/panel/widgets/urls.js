/* Custom URLs per language and the direct links that redirect here. */
import { html } from '@qino/pub/html.js';
import { api, ctx, t } from '@qino/pub/qino.js';

export const css = `
.-urls table { width:100%; }
.-urls .-url { width:100%; }
.-urls .-custom { display:none; }
.-urls .-custom:checked { display:block; }
.-urls .-base { font-size:.7em; white-space:nowrap; padding-right:0; }
.-urls .-addForm { display:flex; gap:.3em; }
.-urls .-add { flex:1; }
.-urls .-delete { cursor:pointer; width:1.25em; }
`;

export default async function (el, { node, signal }) {
  const ref = api.cms.node(node.id);
  const { urls = [], redirects = [] } = await ref.urls.get({}, { signal }) ?? {};
  const base = location.host + ctx.appUrl;

  el.head = t`Urls`;
  el.badge = redirects.length;

  const urlRow = (row) => html.async`<tr itemid="${row.lang}">
    <td>${row.lang}
    <td><input class=-url value="${row.url}" maxlength=180>
    <td><input class=-custom type=checkbox ${row.custom ? 'checked' : ''} title="${t`custom`}">
    <td><input class=-target type=checkbox ${row.target ? 'checked' : ''} title="${t`New window`}">`;

  await el.html`<div class=-urls>
    <table class="-styled -noborder">${urls.map(urlRow)}</table>
    <br><b>${t`Direct links`}</b>
    <table class="-styled -noborder -links">
      <tr>
        <td class=-base>${base}
        <td colspan=2><form class=-addForm><input class=-add maxlength=180><button>${t`add`}</button></form>
      ${redirects.map((r) => html`<tr itemid="${r.request}">
        <td class=-base>${base}
        <td>${r.request}
        <td class=-delete>✕`)}
    </table>
  </div>`;

  const lang = (inner) => inner.closest('[itemid]').getAttribute('itemid');
  el.on('change', '.-url', (inp) => {
    ref.urls(lang(inp)).put({ url: inp.value });
    inp.closest('tr').querySelector('.-custom').checked = true;
  });
  el.on('change', '.-target', (inp) => ref.urls(lang(inp)).target.put({ value: inp.checked ? '_blank' : '' }));
  el.on('change', '.-custom', (inp) =>
    ref.urls(lang(inp)).custom.delete().then((url) => inp.closest('tr').querySelector('.-url').value = url));

  el.on('submit', '.-addForm', (form, e) => {
    e.preventDefault();
    const add = form.querySelector('.-add');
    add.value && ref.redirects.post({ url: add.value });
  });
  el.on('input', '.-add', (inp) =>
    api.cms['request-used'].get({ url: inp.value }).then(({ used }) => inp.style.borderColor = used ? 'red' : 'green'));
  el.on('click', '.-delete', (td) => ref.redirects.delete({ url: td.closest('tr').getAttribute('itemid') }));
}
