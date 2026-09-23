import { api } from "./api.js";
import { ctx } from "./qino.js";

const cache = new Map();
const pending = new Map();

function interpolate(template, values) {
  return values.reduce((s, v, i) => s.replaceAll(`{${i}}`, String(v ?? "")), template);
}

// Max texts per call — keep in sync with T_WARN in core/api.ts.
const MAX = 400;

function flush() {
  const batch = new Map(pending);
  pending.clear();
  const texts = [...batch.keys()];
  const calls = [];
  for (let i = 0; i < texts.length; i += MAX) calls.push(api.core.t.post({ texts: texts.slice(i, i + MAX) }));
  Promise.all(calls).then(results => {
    const all = Object.assign(Object.create(null), ...results); // no prototype: a text "toString" must not match
    for (const [text, resolve] of batch) resolve(stored[text] = all[text] ?? text);
    save();
  }).catch(() => {
    // A failed request is no error: show the original. Remove the entries so the next call retries.
    for (const [text, resolve] of batch) { cache.delete(text); resolve(stored[text] ?? text); }
  });
}

export function t(strings, ...values) {
  const original = strings.reduce((acc, s, i) => acc + `{${i - 1}}` + s);
  let entry = cache.get(original);
  if (!entry) {
    entry = { translated: stored[original] };
    // Fresh store: use it. Otherwise ask the server; stale texts are shown meanwhile.
    if (fresh && entry.translated !== undefined) entry.promise = Promise.resolve(entry.translated);
    else {
//      if (!pending.size) queueMicrotask(flush); // the first text of a batch schedules it
      // The first text of a batch schedules the flush. A frame's delay collects a burst of widgets
      // (a microtask only one), and unlike requestAnimationFrame a timer also fires in hidden tabs.
      if (!pending.size) setTimeout(flush, 20);
      const asked = new Promise(resolve => pending.set(original, resolve)).then(text => entry.translated = text);
      entry.promise = entry.translated === undefined ? asked : Promise.resolve(entry.translated);
    }
    cache.set(original, entry);
  }
  // Awaitable, but already a string: `${t`…`}` renders the original until the next render.
  const p = entry.promise.then(translated => interpolate(translated, values));
  p.toString = () => interpolate(entry.translated ?? original, values);
  return p;
}

// ─── Store ────────────────────────────────────────────────────────────────────
//
// Translations are stored across page loads: within FRESH they are used without asking; after that
// one visit refreshes them. So an edited translation shows up one reload after FRESH expires.
//
// Two backends: localStorage is synchronous, so the original never flashes; Cache Storage is async
// and shows the swap on every load. Toggle `viaCache` to compare.

const FRESH = 300e3;
// Storage is per origin, so the key includes app and language. No namespace — `core.t` has none.
const KEY = `qino.t|${ctx.appUrl}|${ctx.lang}`;
const ENTRY = "/t"; // Cache Storage keys are URLs; the cache name holds the identity

const viaCache = true;

// Storage may be unavailable (private window, blocked site data); the page works without it.
const attempt = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

const stored = Object.create(null);
let fresh = false;

/** Load the stored set; its age only decides whether to ask the server. Expired texts are still
 *  better than the untranslated original. */
function adopt(saved) {
  if (!saved) return;
  Object.assign(stored, saved.texts);
  fresh = Date.now() - saved.at < FRESH;
}

if (viaCache) {
  globalThis.caches?.open(KEY).then((c) => c.match(ENTRY)).then((r) => r?.json()).then(adopt).catch(() => {});
} else {
  adopt(attempt(() => JSON.parse(localStorage.getItem(KEY)), null));
}

/** Save the current set. Fire and forget. */
function save() {
  const json = JSON.stringify({ at: Date.now(), texts: stored });
  if (viaCache) globalThis.caches?.open(KEY).then((c) => c.put(ENTRY, new Response(json))).catch(() => {});
  else attempt(() => localStorage.setItem(KEY, json));
}
