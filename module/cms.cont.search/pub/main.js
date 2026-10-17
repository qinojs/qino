import { api } from '@qino/pub/api.js';

// Results while typing: only the part "hits" renders again, and the url keeps the term.
// Delegated on document, since frontend layouts have no cms.mjs.
const QUERY = 'cms_search';
let timer, latest = 0;

document.addEventListener('input', (e) => {
  const input = e.target.closest?.(`[qcms-mod="cont.search"] input[name=${QUERY}]`);
  if (!input) return;
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const box = input.closest('[qcms-mod="cont.search"]');
    const search = input.value.trim();
    const run = ++latest;
    const hits = await api.cms.node(box.getAttribute('qcms-id')).html.part('hits').post({ vars: { search } });
    if (run !== latest) return; // a newer term is on its way
    box.querySelector('[cms-part=hits]').innerHTML = hits;
    const url = new URL(location.href);
    if (search) url.searchParams.set(QUERY, search); else url.searchParams.delete(QUERY);
    history.replaceState(history.state, '', url);
  }, 250);
});
