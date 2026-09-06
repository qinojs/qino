import { api } from "./api.js";
import { ctx } from "./qino.js";

const cache = new Map();
const pending = new Map();

function interpolate(template, values) {
  return values.reduce((s, v, i) => s.replaceAll(`{${i}}`, String(v ?? "")), template);
}

// A microtask can queue more texts than one call may carry — keep in step with T_WARN in core/api.ts.
const MAX = 400;

function flush() {
  const batch = new Map(pending);
  pending.clear();
  const texts = [...batch.keys()];
  const calls = [];
  for (let i = 0; i < texts.length; i += MAX) calls.push(api.core.t.post({ texts: texts.slice(i, i + MAX) }));
  Promise.all(calls).then(results => {
    const all = Object.assign(Object.create(null), ...results); // a text called "toString" must not find one
    for (const [text, resolve] of batch) resolve(stored[text] = all[text] ?? text);
    save();
  }).catch(() => {
    // No translation is not an error — the original is the answer, as for a text the server does not
    // know. The entries leave the cache so the next call asks again instead of keeping the outage.
    for (const [text, resolve] of batch) { cache.delete(text); resolve(stored[text] ?? text); }
  });
}

export function t(strings, ...values) {
  const original = strings.reduce((acc, s, i) => acc + `{${i - 1}}` + s);
  let entry = cache.get(original);
  if (!entry) {
    entry = { translated: stored[original] };
    // A fresh store is the answer; anything else has to ask, and known-but-stale texts at least no
    // longer wait for the reply.
    if (fresh && entry.translated !== undefined) entry.promise = Promise.resolve(entry.translated);
    else {
//      if (!pending.size) queueMicrotask(flush); // the first text of a batch schedules it
      // The first text of a batch schedules it. A frame's worth of delay collects a whole burst of
      // widgets where a microtask catches one — and unlike requestAnimationFrame a timer still fires
      // in a hidden tab, which is where every `await t\`…\`` would otherwise sit and wait.
      if (!pending.size) setTimeout(flush, 20);
      const asked = new Promise(resolve => pending.set(original, resolve)).then(text => entry.translated = text);
      entry.promise = entry.translated === undefined ? asked : Promise.resolve(entry.translated);
    }
    cache.set(original, entry);
  }
  // Awaitable, and already a string before it resolves: `${t`…`}` in a template renders the
  // original and is replaced on the next render.
  const p = entry.promise.then(translated => interpolate(translated, values));
  p.toString = () => interpolate(entry.translated ?? original, values);
  return p;
}

// ─── Store ────────────────────────────────────────────────────────────────────
//
// Translations outlive the page load here: within FRESH the page renders them at once and asks for
// nothing, afterwards one visit refreshes the set and the next one is fast again. That is the whole
// invalidation story — an edited translation shows up a reload after the window closes.
//
// Two backends on purpose. localStorage answers synchronously, so the original is never on screen;
// a Cache Storage read cannot and therefore shows the swap on every load. Flip `viaCache` to see it.

const FRESH = 300e3;
// Storage is per origin, translations are not: two apps or languages must not mix. The language
// namespace is none of the key's business — `core.t` answers API calls outside any of them.
const KEY = `qino.t|${ctx.appUrl}|${ctx.lang}`;
const ENTRY = "/t"; // Cache Storage keys are URLs; the cache name already carries the identity

const viaCache = true;

// A browser may refuse storage outright (private window, site data blocked) — never at the price of
// the page, which works without any of this.
const attempt = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

const stored = Object.create(null);
let fresh = false;

/** Take what was stored; its age only decides whether the page still has to ask. An expired set is
 *  the best guess there is — far better on screen than the untranslated original. */
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

/** Hand the current set to the backend. Fire and forget: a miss costs a lookup, never a page. */
function save() {
  const json = JSON.stringify({ at: Date.now(), texts: stored });
  if (viaCache) globalThis.caches?.open(KEY).then((c) => c.put(ENTRY, new Response(json))).catch(() => {});
  else attempt(() => localStorage.setItem(KEY, json));
}
