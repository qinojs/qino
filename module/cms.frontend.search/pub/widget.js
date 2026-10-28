import { api } from '@qino/pub/api.js';
import { html } from '@qino/pub/html.js';
import { ctx } from '@qino/pub/qino.js';
import { t } from '@qino/pub/t.js';

export const css = `
.-search form > span { min-width:0; }
.-search input { width:100%; box-sizing:border-box; }
.-search table { width:100%; table-layout:fixed; }
.-search td { overflow-wrap:anywhere; }
.-search .-preview { width:4.5rem; }
.-search .-preview img { width:100%; height:3.5rem; object-fit:contain; }
`;

function mark(text, words) {
  if (!words.length) return html`${text}`;
  const parts = String(text ?? '').split(new RegExp(`(${words.map(RegExp.escape).join('|')})`, 'ig'));
  return html.join(parts.map((part, i) => i % 2 ? html`<mark>${part}</mark>` : html`${part}`));
}

function pathLinks(path) {
  return html.join(path.map((node) => html`<a href="${node.url}">${node.title}</a>`), ' › ');
}

export default async function (widget, { node, signal }) {
  widget.head = t`Search`;
  await widget.html`<div class="-standalone -search">
    <form role=search class=-h1>
      <span><input type=search name=search aria-label="${t`Search`}" placeholder="${t`Title, text, URL, ID or module name`}"></span>
    </form>
    <div aria-live=polite></div>
  </div>`;
  const input = widget.querySelector('input');
  const output = widget.querySelector('[aria-live]');
  input.addEventListener('focus', () => input.select(), { signal });
  const key = `cms.frontend.search:${ctx.appUrl}`;
  try { input.value = sessionStorage.getItem(key) ?? ''; } catch { /* Storage may be unavailable. */ }
  widget.addEventListener('error', (event) => {
    const image = event.target;
    if (!image.matches?.('.-preview img')) return;
    image.hidden = true;
    image.nextElementSibling.hidden = false;
  }, { capture: true, signal });
  let timer, pending, latest = 0, ready = '';

  async function load(run) {
    const search = input.value.trim();
    pending = new AbortController();
    const requestSignal = AbortSignal.any([signal, pending.signal]);
    try {
      const searching = await t`Searching…`;
      if (run !== latest || requestSignal.aborted) return;
      output.textContent = searching;
      const found = await api['cms.frontend.search'].search.get({ pid: node.id, search }, { signal: requestSignal });
      const titles = { pages: t`Pages`, contents: t`Contents`, files: t`Files`, users: t`Users` };
      const groups = Object.keys(titles).filter((name) => found[name]?.length);
      const words = search.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 4);
      const result = groups.length
        ? await html.async`${groups.map((name) => {
          const rows = found[name];
          return html.async`<section>
            <h3 class=-h1><span>${titles[name]}</span><small>${rows.length >= found.limit ? t`First ${found.limit} results` : rows.length}</small></h3>
            <table class="-styled -noborder"><tbody>${rows.map((row) => html.async`<tr>
              ${name === 'files' ? html`<td class=-preview><a href="${row.url}" aria-label="${row.title}">
                ${row.thumb ? html`<img src="${row.thumb}" alt="" loading=lazy>` : ''}
                <u2-ico icon=description aria-hidden=true${row.thumb ? html.raw(' hidden') : ''}></u2-ico>
              </a>` : ''}
              <td>
                <a href="${row.url}" data-result><strong>${mark(row.title, words)}</strong></a>
                ${row.breadcrumb?.length ? html.async`<nav aria-label="${t`Breadcrumb`}"><small>${pathLinks(row.breadcrumb)}</small></nav>` : ''}
                <div><small>${mark(row.info, words)}</small></div>
                ${row.snippet ? html`<p>${mark(row.snippet, words)}</p>` : ''}
                ${row.pages?.length ? html.async`<div><small>${t`Used on`}: ${html.join(row.pages.map((page) => html`
                  <span>${pathLinks([...page.breadcrumb, page])}</span>`), ' · ')}</small></div>` : ''}
            `)}</tbody></table>
          </section>`;
        })}`
        : await html.async`<p>${t`No results found`}</p>`;
      if (run === latest && !requestSignal.aborted) { output.innerHTML = result; ready = search; }
    } catch (error) {
      if (run === latest && !requestSignal.aborted) output.textContent = error.message;
    }
  }

  const schedule = (delay) => {
    clearTimeout(timer);
    pending?.abort();
    ready = '';
    const run = ++latest;
    try {
      if (input.value) sessionStorage.setItem(key, input.value);
      else sessionStorage.removeItem(key);
    } catch { /* Storage may be unavailable. */ }
    if (!input.value.trim()) { output.replaceChildren(); return; }
    timer = setTimeout(() => load(run), delay);
  };
  widget.on('input', 'input', () => schedule(250));
  widget.on('submit', 'form', (_form, event) => {
    event.preventDefault();
    if (ready === input.value.trim()) output.querySelector('[data-result]')?.click();
    else schedule(0);
  });
  widget.on('focusin', '[data-result]', (link) => {
    for (const row of output.querySelectorAll('tr.active')) row.classList.remove('active');
    link.closest('tr').classList.add('active');
  });
  widget.on('keydown', (_el, event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cms.panel.sidebar.set('');
      event.target.blur?.();
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || ready !== input.value.trim()) return;
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const links = [...output.querySelectorAll('[data-result]')];
    if (!links.length) return;
    event.preventDefault();
    const current = links.indexOf(event.target.closest?.('[data-result]'));
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const next = current < 0 ? (step > 0 ? 0 : links.length - 1) : (current + step + links.length) % links.length;
    links[next].focus();
    links[next].scrollIntoView({ block: 'nearest' });
  });
  if (input.value.trim()) schedule(0);
  return () => { clearTimeout(timer); pending?.abort(); };
}
