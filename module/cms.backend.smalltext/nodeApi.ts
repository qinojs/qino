// deno-lint-ignore-file no-explicit-any
import { getCtx, sql } from "../core/mod.ts";
import type { Node } from "../cms/mod.ts";
import { service as cmsTextService } from "../cms.text/mod.ts";

function matchCase(translated: string, original: string): string {
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
    const langs = node.app.languages.all;

    if ("count_clean" in vars) {
        await db.query`UPDATE smalltext SET count = 0`;
        return true;
    }

    if ("code_log_clean" in vars) {
        await db.query`DELETE FROM smalltext_code_log`;
        return true;
    }

    if ("delete_not_used" in vars) {
        const cond = sql.join(langs.map(l => sql`COALESCE(${sql.id(l)}, '') = ''`), " AND ");
        await db.query`DELETE FROM smalltext WHERE count = 0 AND ${cond}`;
        return true;
    }

    if ("toggle_counter" in vars) {
        node.app.settings.core.smalltext.counter(vars.toggle_counter ? "1" : "");
        return true;
    }

    if ("save_lang" in vars) {
        const { hash, ns, lang, value } = vars.save_lang;
        if (!langs.includes(String(lang))) return false;
        await db.query`UPDATE smalltext SET ${sql.id(lang)} = ${String(value)} WHERE hash = ${String(hash)} AND namespace = ${String(ns)}`;
        return true;
    }

    if ("translate_untranslated" in vars) {
        const svc = cmsTextService(ctx);
        const rows = await db.query`SELECT hash, namespace, original, ${sql.join(langs.map(l => sql.id(l)))} FROM smalltext WHERE ${sql.join(langs.map(l => sql`COALESCE(${sql.id(l)}, '') = ''`), " OR ")}`;
        let count = 0;
        for (const row of rows) {
            const sourceLang = langs.find(l => row[l]) ?? 'en';
            if (!sourceLang) continue;
            for (const targetLang of langs) {
                if (row[targetLang]?.trim()) continue;
                const source = row[sourceLang] || row.original;
                const translated = matchCase(await svc.transl(source, targetLang, sourceLang) || "", row.original);
                if (!translated) continue;
                await db.query`UPDATE smalltext SET ${sql.id(targetLang)} = ${translated} WHERE hash = ${row.hash} AND namespace = ${row.namespace}`;
                count++;
            }
        }
        return { translated: count };
    }

    if ("delete_entry" in vars) {
        const { hash, ns } = vars.delete_entry;
        await db.query`DELETE FROM smalltext WHERE hash = ${String(hash)} AND namespace = ${String(ns)}`;
        return true;
    }

    if ("translate_entry" in vars) {
        const svc = cmsTextService(ctx);
        const { hash, ns } = vars.translate_entry;
        const row = await db.row`SELECT hash, namespace, original, ${sql.join(langs.map(l => sql.id(l)))} FROM smalltext WHERE hash = ${String(hash)} AND namespace = ${String(ns)}`;
        if (!row) return false;
        const sourceLang = langs.find(l => row[l]?.trim()) ?? null;
        if (!sourceLang) return false;
        let count = 0;
        for (const targetLang of langs) {
            if (row[targetLang]?.trim()) continue;
            const translated = matchCase(await svc.transl(row[sourceLang], targetLang, sourceLang) || "", row.original);
            if (!translated) continue;
            await db.query`UPDATE smalltext SET ${sql.id(targetLang)} = ${translated} WHERE hash = ${row.hash} AND namespace = ${row.namespace}`;
            count++;
        }
        return { translated: count };
    }

    return false;
}
