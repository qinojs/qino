import { apt } from "./qino.js";

const cache = new Map();
const pending = new Map();
let scheduled = false;

function interpolate(template, values) {
  return values.reduce((s, v, i) => s.replace(`###${i + 1}###`, String(v ?? "")), template);
}

function flush() {
  scheduled = false;
  const batch = new Map(pending);
  pending.clear();
  apt.core.t.post({ texts: [...batch.keys()] }).then(result => {
    for (const [text, { resolve }] of batch) resolve(result[text] ?? text);
  }).catch(err => {
    for (const { reject } of batch.values()) reject(err);
  });
}

export function t(strings, ...values) {
  const original = strings.reduce((acc, str, i) =>
    acc + str + (i < strings.length - 1 ? `###${i + 1}###` : ""), "");
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
