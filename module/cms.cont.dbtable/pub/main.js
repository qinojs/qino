// The list of cms.cont.dbtable: search, filters, order, pages, edits in place, new rows in a
// dialog, copy, delete, uploads.
import { api } from '@qino/pub/api.js';
import { t } from '@qino/pub/t.js';

const debounce = (fn, ms) => { let timer; return (...a) => { clearTimeout(timer); timer = setTimeout(() => fn(...a), ms); }; };
const dialogs = () => import('@qino/u2/js/dialog/dialog.js');

for (const root of document.querySelectorAll('[qcms-mod="cont.dbtable"]')) init(root);

function init(root) {
  const node = api.cms.node(root.getAttribute('qcms-id'));
  const id = root.dataset.id || undefined; // the page's ?id=, which fixed fields may name
  const call = (vars) => node.api.post({ ...vars, id });
  const part = (name, vars = {}) => node.html.part(name).post({ vars: { ...vars, id } });
  const pager = () => root.querySelector('.-pager');
  const page = () => Number(pager()?.dataset.page) || 1;
  const list = async (p = page()) => {
    root.querySelector('[cms-part=list]').innerHTML = await part('list', { page: p });
  };
  const valueOf = (el) => el.type === 'checkbox' ? (el.checked ? 1 : 0) : el.isContentEditable ? el.innerHTML : el.value;

  /* search and filters narrow the list, from its first page */
  root.querySelector('.-search')?.addEventListener('input', debounce(async (e) => {
    await call({ do: 'search', value: e.target.value });
    list(1);
  }, 250));
  const filter = async (el) => {
    await call({ do: 'filter', field: el.dataset.filter, value: el.value });
    list(1);
  };
  root.addEventListener('change', (e) => e.target.dataset.filter !== undefined && filter(e.target));
  root.addEventListener('input', debounce((e) => e.target.matches('input[data-filter]') && filter(e.target), 300));

  /* a field saves as it changes */
  const save = async (el) => {
    const row = el.closest('[data-row]');
    if (!row) return;
    el.classList.add('-saving');
    const res = await call({ do: 'update', row: row.dataset.row, field: el.dataset.f, value: valueOf(el) });
    el.classList.remove('-saving');
    if (res?.error) (await dialogs()).alert(res.error);
  };
  root.addEventListener('change', (e) => e.target.dataset.f && !e.target.isContentEditable && save(e.target));
  root.addEventListener('focusout', (e) => e.target.dataset.f && e.target.isContentEditable && save(e.target));

  const upload = (row, field) => new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file' });
    input.addEventListener('change', async () => {
      if (!input.files[0]) return resolve(false);
      const body = new FormData();
      body.append('file', input.files[0]);
      const url = new URL(location.href);
      url.search = new URLSearchParams({ dbtable_upload: root.getAttribute('qcms-id'), row, field, ...id ? { id } : {} });
      const res = await fetch(url, { method: 'POST', body, headers: { 'x-csrf-token': globalThis.qino?.csrfToken ?? '' } });
      if (!res.ok) (await dialogs()).alert(await res.text());
      resolve(res.ok);
    });
    input.click();
  });

  /* a new row: its fields in a dialog */
  const insert = async () => {
    const { modal } = await dialogs();
    const add = (close) => async function () {
      const values = {};
      for (const el of this.element.querySelectorAll('[data-f]')) values[el.dataset.f] = valueOf(el);
      const res = await call({ do: 'insert', values });
      if (res?.error) return (await dialogs()).alert(res.error);
      await list();
      if (close) this.element.close();
      else this.element.querySelector('.-body').innerHTML = await part('insert');
    };
    await modal({
      body: `<div class=-body>${await part('insert')}</div>`,
      buttons: [{ title: await t`Add`, type: 'button', action: add(false) }, { title: await t`Add and close`, type: 'button', action: add(true) }, { title: await t`Cancel` }],
      init: (el) => el.classList.add('-dbtable'),
    });
  };

  root.addEventListener('click', async (e) => {
    const target = e.target;
    if (target.closest('.-new')) return insert();
    if (target.closest('.-pager .-prev')) return list(page() - 1);
    if (target.closest('.-pager .-next')) return list(page() + 1);

    const file = target.closest('[data-upload], [data-clear]');
    const fileRow = file?.closest('[data-row]');
    if (fileRow) {
      if (file.dataset.clear) {
        if (!await (await dialogs()).confirm(await t`Remove the file?`)) return;
        await call({ do: 'clear', row: fileRow.dataset.row, field: file.dataset.clear });
      } else if (!await upload(fileRow.dataset.row, file.dataset.upload)) return;
      return list();
    }

    const th = target.closest('th[data-sort]');
    if (th && !target.isContentEditable) {
      const res = await call({ do: 'order', field: th.dataset.f });
      if (res?.order) list(1);
      return;
    }

    const action = target.closest('[data-do]');
    const row = action?.closest('[data-row]');
    if (!row) return;
    const what = action.dataset.do;
    if (what === 'delete' && !await (await dialogs()).confirm(await t`Delete the row?`)) return;
    const res = await call({ do: what, row: row.dataset.row });
    if (res?.error) return (await dialogs()).alert(res.error);
    what === 'delete' ? row.remove() : list();
  });
}
