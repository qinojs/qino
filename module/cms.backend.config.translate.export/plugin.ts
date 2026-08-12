// deno-lint-ignore-file no-explicit-any
import { ConflictError, html, type HtmlString, type App } from "../core/mod.ts";
import { backend } from "../cms.backend/mod.ts";
import type { Node } from "../cms/mod.ts";

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, "cms.backend.config.translate.export", { en: "Export", de: "Export" });
}

type Change = { ns: string; lang: string; file: string; added: { key: string; new: string }[]; changed: { key: string; old: string; new: string }[]; removed: string[] };

// Compare export map against the current file; null = no difference
async function diffFile(ns: string, lang: string, file: string, map: Record<string, string>): Promise<Change | null> {
  let old: Record<string, string> = {};
  try { old = JSON.parse(await Deno.readTextFile(file)); }
  catch (e) {
    if (e instanceof SyntaxError) throw new ConflictError(`Invalid locale file: ${ns}/locale/${lang}.json`);
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  const added: Change["added"] = [], removed: string[] = [], changed: Change["changed"] = [];
  for (const [k, v] of Object.entries(map)) {
    if (!(k in old)) added.push({ key: k, new: v });
    else if (old[k] !== v) changed.push({ key: k, old: old[k], new: v });
  }
  for (const k of Object.keys(old)) if (!(k in map)) removed.push(k);
  return added.length || changed.length || removed.length ? { ns, lang, file, added, changed, removed } : null;
}

// Namespace maps to a module dir (empty ns = core); files land in <module>/locale/<lang>.json
async function api(node: Node, vars: any): Promise<any> {
  if (await node.access() < 2) return false;
  const preview = "preview" in vars;
  if (!preview && !("export" in vars)) return false;

  const app = node.app;
  const written = [];
  const skipped = [];
  const changes = [];
  for (const [ns, byLang] of Object.entries(await app.languages.export())) {
    const name = ns || "core";
    const dir = app.modules.get(name)?.dir;
    if (!dir) { skipped.push(name); continue; } // url-based module, not on disk
    const localeDir = dir + "locale/";
    for (const [lang, map] of Object.entries(byLang as Record<string, Record<string, string>>)) {
      const file = localeDir + lang + ".json";
      const change = await diffFile(name, lang, file, map);
      if (preview && change) changes.push(change);
      else if (!preview) {
        await Deno.mkdir(localeDir, { recursive: true });
        await Deno.writeTextFile(file, JSON.stringify(map, null, 2) + "\n");
        written.push(file);
      }
    }
  }
  return preview ? { changes } : { written, skipped };
}

function render(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  return html.async`<div class=u2-card>
  <div class=-head>${t`Export translations`}</div>
  <div class=-body>
    <p>${t`Write current translations into each module's locale folder.`}
    <button data-action=preview>${t`Preview changes`}</button>
    <button data-action=export>${t`Export to locale files`}</button>
    <div data-result></div>
  </div>
</div>`;
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render,
    api,
  },
};
