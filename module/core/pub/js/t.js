import { api } from "./api.js";
import { ctx } from "./qino.js";
import { fill, tag } from "./tag.js";

// Texts asked ("ns\noriginal" → entry), and per namespace those waiting for the next request (original → resolve).
const cache = new Map();
const pending = new Map();

// Max texts per call — keep in sync with T_WARN in core/api.ts.
const MAX = 400;

const fetchTexts = (ns, texts) => {
  const calls = [];
  for (let i = 0; i < texts.length; i += MAX) calls.push(api.core.t.post({ texts: texts.slice(i, i + MAX), ...ns ? { ns } : {} }));
  return Promise.all(calls).then((res) => Object.assign(Object.create(null), ...res)); // no prototype: a text "toString" must not match
};

function flush() {
  const batches = [...pending];
  pending.clear();
  for (const [ns, batch] of batches) {
    fetchTexts(ns, [...batch.keys()]).then(all => {
      const into = stored[ns] ??= Object.create(null);
      for (const [text, resolve] of batch) resolve(into[text] = all[text] ?? text);
      save();
    }).catch(() => {
      // A failed request is no error: show the original. Remove the entries so the next call retries.
      for (const [text, resolve] of batch) { cache.delete(ns + "\n" + text); resolve(stored[ns]?.[text] ?? text); }
    });
  }
}

function translate(ns, original, values) {
  const key = ns + "\n" + original;
  let entry = cache.get(key);
  if (!entry) {
    entry = { translated: stored[ns]?.[original] };
    // Stored: use it; a stale store is refreshed as a whole (refresh). Otherwise ask the server.
    if (entry.translated !== undefined) entry.promise = Promise.resolve(entry.translated);
    else {
//      if (!pending.size) queueMicrotask(flush); // the first text of a batch schedules it
      // The first text of a batch schedules the flush. A frame's delay collects a burst of widgets
      // (a microtask only one), and unlike requestAnimationFrame a timer also fires in hidden tabs.
      if (!pending.size) setTimeout(flush, 20);
      const waiting = pending.get(ns) ?? pending.set(ns, new Map()).get(ns);
      entry.promise = new Promise(resolve => waiting.set(original, resolve)).then(text => entry.translated = text);
    }
    cache.set(key, entry);
  }
  // Awaitable, but already a string: `${t`…`}` renders the original until the next render.
  const p = entry.promise.then(translated => fill(translated, values));
  p.toString = () => fill(entry.translated ?? original, values);
  return p;
}

// No AsyncLocalStorage here: t.with(ns, fn) holds for the t`` calls fn makes synchronously; after an
// await, use t.in(ns). The language is the server's to choose (the page's, or the user's per namespace).
let current;
const scope = { get: () => current, run: (next, fn) => { const prev = current; current = next; try { return fn(); } finally { current = prev; } } };

/** t`…`, t.in(ns)`…`, t.with(ns, fn) — as on the server (core/lib/LangManager.ts). */
export const t = tag(translate, scope);

// ─── Store ────────────────────────────────────────────────────────────────────
//
// Translations are stored across page loads: within FRESH they are used without asking; after that
// one visit refreshes them. So an edited translation shows up one reload after FRESH expires.
//
// Two backends: localStorage is synchronous, so the original never flashes; Cache Storage is async
// and shows the swap on every load. Toggle `viaCache` to compare.

const FRESH = 300e3;
// Storage is per origin, so the key includes app and language; the texts inside are by namespace.
const KEY = `qino.t2|${ctx.appUrl}|${ctx.lang}`;
const ENTRY = "/t"; // Cache Storage keys are URLs; the cache name holds the identity

const viaCache = true;

// Storage may be unavailable (private window, blocked site data); the page works without it.
const attempt = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

const stored = Object.create(null);
let at = 0;

/** Load the stored set; its age only decides whether to refresh it. Expired texts are still
 *  better than the untranslated original. */
function adopt(saved) {
  if (!saved) return;
  for (const [ns, texts] of Object.entries(saved.texts ?? {})) {
    stored[ns] = Object.assign(Object.create(null), texts, stored[ns]);
  }
  at = Number(saved.at) || 0;
  if (Date.now() - at >= FRESH) refresh();
}

function refresh() {
  const entries = Object.entries(stored).filter(([, m]) => Object.keys(m).length);
  if (!entries.length) return;
  Promise.all(entries.map(([ns, m]) => fetchTexts(ns, Object.keys(m)).then((map) => [ns, map]))).then((all) => {
    for (const [ns, map] of all) Object.assign(stored[ns] ??= Object.create(null), map);
    at = Date.now();
    save();
  }).catch(() => {});
}

globalThis.caches?.delete(`qino.t|${ctx.appUrl}|${ctx.lang}`).catch(() => {}); // the store before namespaces (> 1.0: remove)

if (viaCache) {
  globalThis.caches?.open(KEY).then((c) => c.match(ENTRY)).then((r) => r?.json()).then(adopt).catch(() => {});
} else {
  adopt(attempt(() => JSON.parse(localStorage.getItem(KEY)), null));
}

/** Save the current set, keeping its age (`at` advances only on a full refresh). Fire and forget. */
function save() {
  const json = JSON.stringify({ at: at || (at = Date.now()), texts: stored });
  if (viaCache) globalThis.caches?.open(KEY).then((c) => c.put(ENTRY, new Response(json))).catch(() => {});
  else attempt(() => localStorage.setItem(KEY, json));
}

/** Drop the stored set, e.g. after the user chose another language for a namespace. */
export function forget() {
  if (viaCache) return globalThis.caches?.delete(KEY).catch(() => {});
  attempt(() => localStorage.removeItem(KEY));
}
