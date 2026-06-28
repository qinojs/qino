// deno-lint-ignore-file no-explicit-any
import { getCtx, type App } from "../core/mod.ts";
import { backend } from "../cms.backend/mod.ts";
import type { Node } from "../cms/mod.ts";

export const name = "cms.backend.smalltext.export";
export const needs = ["cms.backend.smalltext"];

export async function install({ app }: { app: App }): Promise<void> {
    await backend.install(app, "cms.backend.smalltext.export", { en: "Export", de: "Export" });
}

// Namespace maps to a module dir (empty ns = core); files land in <module>/locale/<lang>.json
async function api(node: Node, vars: any): Promise<any> {
    if (await node.access() < 2) return false;
    if (!(await getCtx().user?.get("superuser"))) return false; // writes into module source dirs
    if (!("export" in vars)) return false;

    const app = node.app;
    const data = await app.languages.export();
    const written: string[] = [];
    const skipped: string[] = [];
    for (const [ns, byLang] of Object.entries(data)) {
        const dir = app.modules.get(ns || "core")?.dir;
        if (!dir) { skipped.push(ns || "core"); continue; } // url-based module, not on disk
        const localeDir = dir + "locale/";
        await Deno.mkdir(localeDir, { recursive: true });
        for (const [lang, map] of Object.entries(byLang as Record<string, unknown>)) {
            const file = localeDir + lang + ".json";
            await Deno.writeTextFile(file, JSON.stringify(map, null, 2) + "\n");
            written.push(file);
        }
    }
    return { written, skipped };
}

async function render(node: Node): Promise<string> {
    const app = node.app;
    return `<div class=u2-card>
    <div class=-head>${await app.t`Export translations`}</div>
    <div class=-body>
        <p>${await app.t`Write current translations into each module's locale folder.`}
        <button data-action=export>${await app.t`Export to locale files`}</button>
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
