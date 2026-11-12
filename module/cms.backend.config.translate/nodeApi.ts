// deno-lint-ignore-file no-explicit-any
import { getCtx } from "@qino/qino";
import { service as cmsTextService } from "@qino/qino/cms.text";

import { key, missing, textsOf } from "./plugin.ts";

import type { Node } from "@qino/qino/cms";

function matchCase(translated: string, original: string) {
  if (!translated || !original) return translated;
  const first = original[0];
  if (first === first.toUpperCase() && first !== first.toLowerCase()) return translated[0].toUpperCase() + translated.slice(1);
  if (first === first.toLowerCase() && first !== first.toUpperCase()) return translated[0].toLowerCase() + translated.slice(1);
  return translated;
}

export default async function api(node: Node, vars: any): Promise<any> {
  const ctx = getCtx();
  if (await node.access() < 2) return false;

  const db = node.app.db;
  const languages = node.app.languages, langs = languages.all;

  // a translation: stored, or removed when empty
  const setText = (hash: string, namespace: string, lang: string, text: string) => db.transaction(async () => {
    await db.exec`DELETE FROM smalltext_lang WHERE hash = ${hash} AND namespace = ${namespace} AND lang = ${lang}`;
    if (text) await db.table("smalltext_lang").insert({ hash, namespace, lang, text });
  });

  // the site's languages a row lacks, machine-translated from its first translation (`needSource`) or the
  // original; how many were added
  const translate = async (rows: any[], needSource = false) => {
    const svc = cmsTextService(ctx), texts = await textsOf(node.app, rows);
    let count = 0;
    for (const row of rows) {
      const has = texts.get(key(row)) ?? {};
      const sourceLang = langs.find((l) => has[l]?.trim());
      if (needSource && !sourceLang) continue;
      const source = sourceLang ? has[sourceLang] : row.original;
      for (const targetLang of langs) {
        if (has[targetLang]?.trim()) continue;
        const translated = matchCase(await svc.transl(source, targetLang, sourceLang ?? "en") || "", row.original);
        if (!translated) continue;
        await setText(row.hash, row.namespace, targetLang, translated);
        count++;
      }
    }
    return count;
  };

  if ("count_clean" in vars) {
    await db.exec`UPDATE smalltext SET count = 0`;
    return true;
  }

  if ("delete_not_used" in vars) {
    await db.exec`DELETE FROM smalltext WHERE count = 0 AND NOT EXISTS (SELECT 1 FROM smalltext_lang l
      WHERE l.hash = smalltext.hash AND l.namespace = smalltext.namespace)`;
    languages.clear();
    return true;
  }

  if ("toggle_counter" in vars) {
    node.app.settings.core.smalltext.counter(vars.toggle_counter ? "1" : "");
    return true;
  }

  if ("save_lang" in vars) {
    const { hash, ns, lang, value } = vars.save_lang;
    if (!langs.includes(String(lang))) return false;
    await setText(String(hash), String(ns), String(lang), String(value));
    languages.clear();
    return true;
  }

  if ("translate_untranslated" in vars) {
    const rows = await db.query`SELECT s.hash, s.namespace, s.original FROM smalltext s WHERE ${missing(langs)} > 0`;
    const count = await translate(rows);
    languages.clear();
    return { translated: count };
  }

  if ("delete_entry" in vars) {
    const { hash, ns } = vars.delete_entry;
    await db.transaction(async () => {
      await db.exec`DELETE FROM smalltext_lang WHERE hash = ${String(hash)} AND namespace = ${String(ns)}`;
      await db.table("smalltext").delete({ hash: String(hash), namespace: String(ns) });
    });
    languages.clear();
    return true;
  }

  if ("translate_entry" in vars) {
    const { hash, ns } = vars.translate_entry;
    const row = await db.row`SELECT hash, namespace, original FROM smalltext WHERE hash = ${String(hash)} AND namespace = ${String(ns)}`;
    if (!row) return false;
    const count = await translate([row], true);
    languages.clear();
    return { translated: count };
  }

  return false;
}
