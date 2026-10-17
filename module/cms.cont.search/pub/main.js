import { api } from '@qino/pub/api.js';

// Results while typing: only the part "hits" renders again, and the url keeps the term.
// Delegated on document, since frontend layouts have no cms.mjs.
const QUERY = 'cms_search';
const searches = new WeakMap();

const entryOf = (box) => JSON.parse(box.querySelector('[data-search-entry]')?.dataset.searchEntry ?? '{}');

document.addEventListener('input', (e) => {
  const input = e.target.closest?.(`[qcms-mod="cont.search"] input[name=${QUERY}]`);
  if (!input) return;
  const box = input.closest('[qcms-mod="cont.search"]');
  let state = searches.get(box);
  if (!state) searches.set(box, state = { latest: 0, generation: 0, queue: Promise.resolve(), entry: entryOf(box) });
  clearTimeout(state.timer);
  const search = input.value.trim();
  const run = ++state.latest;
  if (!search) {
    state.generation++;
    state.entry = {};
  }
  state.timer = setTimeout(() => {
    // One request at a time keeps the stored term in input order, too.
    state.queue = state.queue.then(async () => {
      if (run !== state.latest) return;
      const generation = state.generation;
      const hits = await api.cms.node(box.getAttribute('qcms-id')).html.part('hits').post({ vars: { search, ...state.entry } });
      const fragment = document.createElement('template');
      fragment.innerHTML = hits;
      if (generation === state.generation) state.entry = entryOf(fragment.content);
      if (run !== state.latest) return; // a newer term is on its way
      box.querySelector('[cms-part=hits]').innerHTML = hits;
      const url = new URL(location.href);
      if (search) url.searchParams.set(QUERY, search); else url.searchParams.delete(QUERY);
      history.replaceState(history.state, '', url);
    }).catch(console.error);
  }, 250);
});
