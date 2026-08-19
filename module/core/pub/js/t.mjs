import { api } from "./qino.js";

const cache = new Map();
const pending = new Map();
let scheduled = false;

function interpolate(template, values) {
  return values.reduce((s, v, i) => s.replaceAll(`{${i}}`, String(v ?? "")), template);
}

// One microtask can queue more than one call may carry — keep in step with T_WARN in core/api.ts,
// which treats anything above it as nobody we know.
const MAX = 400;

function flush() {
  scheduled = false;
  const batch = new Map(pending);
  pending.clear();
  const texts = [...batch.keys()];
  const calls = [];
  for (let i = 0; i < texts.length; i += MAX) calls.push(api.core.t.post({ texts: texts.slice(i, i + MAX) }));
  Promise.all(calls).then(results => {
    const all = Object.assign(Object.create(null), ...results); // a text called "toString" must not find one
    for (const [text, { resolve }] of batch) resolve(all[text] ?? text);
  }).catch(err => {
    for (const { reject } of batch.values()) reject(err);
  });
}

export function t(strings, ...values) {
  const original = strings.reduce((acc, str, i) =>
    acc + str + (i < strings.length - 1 ? `{${i}}` : ""), "");
  let entry = cache.get(original);
  if (!entry) {
    entry = { translated: null };
    entry.promise = new Promise((resolve, reject) => {
      pending.set(original, { resolve, reject });
    }).then(translated => { entry.translated = translated; });
    cache.set(original, entry);
    if (!scheduled) { scheduled = true; Promise.resolve().then(flush); }
  }
  const p = entry.promise.then(() => interpolate(entry.translated ?? original, values));
  p.toString = () => interpolate(entry.translated ?? original, values);
  return p;
}
