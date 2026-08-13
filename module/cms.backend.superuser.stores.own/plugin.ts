import { toFileUrl } from "@std/path";
import { errMsg, html, isModuleName, type App, type HtmlString, type Store } from "../core/mod.ts";
import { backend } from "../cms.backend/mod.ts";
import type { Node } from "../cms/mod.ts";
import manifest from "./manifest.json" with { type: "json" };
const { name } = manifest;

/** The app's own modules: a folder store beside data/, so it is deployed and backed up with the app. */
const storeDir = (app: App) => app.appPATH + "module/";
const storeUrl = (app: App) => toFileUrl(storeDir(app)).href;
/** Registered by install() below — the store is how a created module gets installed. */
const ownStore = (app: App): Store => {
  const store = app.stores.get(storeUrl(app));
  if (!store) throw new Error("The own-modules store is not registered");
  return store;
};

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Own modules", de: "Eigene Module" });
  await Deno.mkdir(storeDir(app), { recursive: true });
  await app.stores.install(storeUrl(app));
}

// A module name appears twice in its own sources: in full, and without the "cms." prefix as the
// qcms-mod attribute the CMS renders. Longest first, so the short form only sees what is left.
const rename = (text: string, from: string, to: string) =>
  text.replaceAll(from, to).replaceAll(from.replace(/^cms\./, ""), to.replace(/^cms\./, ""));

const utf8 = (bytes: Uint8Array) => {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return; } // binary
};

/** Copy a module folder, renaming it inside every text file it holds. */
async function copyModule(from: string, to: string, oldName: string, newName: string): Promise<void> {
  await Deno.mkdir(to, { recursive: true });
  for await (const e of Deno.readDir(from)) {
    if (e.name === "tests") continue; // a copied suite would only ever test the template
    if (e.isDirectory) { await copyModule(from + e.name + "/", to + e.name + "/", oldName, newName); continue; }
    const bytes = await Deno.readFile(from + e.name);
    const text = utf8(bytes);
    if (text === undefined) await Deno.writeFile(to + e.name, bytes);
    else await Deno.writeTextFile(to + e.name, rename(text, oldName, newName));
  }
}

/** The smallest thing that is a module — a shape to start from comes from a template, not from here. */
async function blankModule(dir: string, modName: string): Promise<void> {
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(dir + "manifest.json", JSON.stringify({ name: modName }, null, 2) + "\n");
  await Deno.writeTextFile(dir + "plugin.ts", "export function init() {}\n");
}

async function create(app: App, modName: string, template: string): Promise<void> {
  if (!isModuleName(modName)) throw new Error(`Invalid module name: ${modName}`);
  if (app.modules.get(modName)) throw new Error(`Module "${modName}" exists already`);
  const dir = storeDir(app) + modName + "/";
  if (await Deno.stat(dir).then(() => true, () => false)) throw new Error(`Folder "${modName}" exists already`);

  if (!template) await blankModule(dir, modName);
  else {
    // Copying takes the sources, so the module must be on disk — a remote one keeps its code
    // over the wire and would leave a folder without a plugin.ts behind.
    const mod = app.modules.get(template);
    if (!mod?.source.startsWith("file:")) throw new Error(`Template "${template}" is not a local module`);
    await copyModule(mod.dir!, dir, template, modName);
  }
  // Leave nothing half-created behind: an unlinkable module would block the name on the next try.
  await ownStore(app).install(modName)
    .catch(async (e) => {
      await Deno.remove(dir, { recursive: true }).catch(() => {});
      throw e;
    });
}

// --- node API -------------------------------------------------------------

async function api(node: Node, vars: Record<string, unknown>): Promise<{ ok: boolean; message?: string }> {
  try {
    await create(node.app, String(vars.name ?? "").trim(), String(vars.template ?? "").trim());
    return { ok: true };
  } catch (e) {
    return { ok: false, message: errMsg(e) };
  }
}

// --- view -----------------------------------------------------------------

async function render(node: Node): Promise<HtmlString> {
  const app = node.app;
  const t = app.t;
  const store = app.stores.get(storeUrl(app));
  const mine = await (store?.names() ?? Promise.resolve([])).catch(() => []);
  const templates = Object.values(app.modules.all()).filter((mod) => mod.source.startsWith("file:")).map((mod) => mod.name).sort();

  return html.async`<div class=u2-flex>
  <div class=u2-card>
    <div class=-head>${t`Create module`}</div>
    <div class=-body>
      <form data-create>
        <label>${t`Name`} <input name=name value="cms.cont." required autofocus></label>
        <label>${t`Template`}
          <select name=template>
            <option value="">${t`blank`}
            ${templates.map((mod) => html`<option>${mod}`)}
          </select>
        </label>
        <button>${t`Create`}</button>
      </form>
    </div>
    <div><small>${t`The module is created in`} <code>${storeDir(app)}</code> ${t`and installed right away. A template is copied and renamed inside.`}</small></div>
  </div>

  <div class=u2-card>
    <div class=-head>${t`Modules of this app`} <small>${mine.length}</small></div>
    <table class=u2-table>
      ${mine.map((mod) => html.async`<tr>
        <td>${mod}
        <td><small>${app.modules.linked(mod) ? t`active` : t`inactive`}</small>`)}
    </table>
  </div>
</div>`;
}

export const cms = {
  node: { js: ["pub/main.js"], render, api },
};
