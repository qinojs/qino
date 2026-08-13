import { toFileUrl } from "@std/path";
import { errMsg, html, isModuleName, type App, type HtmlString, type Module, type Store } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import type { Node } from "@qino/qino/cms";
import manifest from "./manifest.json" with { type: "json" };
const { name } = manifest;

/** The app's own modules: a folder store beside data/, deployed and backed up with the app. */
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
  text.split(from).map((part) => part.replaceAll(from.replace(/^cms\./, ""), to.replace(/^cms\./, ""))).join(to);

const utf8 = (bytes: Uint8Array) => {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return; } // binary
};

const isModuleFile = (file: unknown): file is string =>
  typeof file === "string" && !file.includes("\\") && file.split("/").every((part) => part !== "" && part !== "." && part !== "..");

/** Copy every published file of a module, renaming it inside text files. The same URL path
 *  works for local and remote modules; the manifest is the portable directory listing. */
async function copyTemplate(template: Module, dir: string, name: string): Promise<void> {
  const files = template.manifest.files;
  if (!files?.length) throw new Error(`Template "${template.name}" does not list its files`);
  const base = new URL(".", template.source);
  for (const file of files) {
    if (!isModuleFile(file)) throw new Error(`Template "${template.name}" lists an invalid file: ${String(file)}`);
    const url = new URL(file.split("/").map(encodeURIComponent).join("/"), base);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Cannot copy "${file}" from template "${template.name}": ${res.status} ${res.statusText}`);
    const target = dir + file;
    await Deno.mkdir(target.slice(0, target.lastIndexOf("/") + 1), { recursive: true });
    const bytes = new Uint8Array(await res.arrayBuffer());
    const text = utf8(bytes);
    if (text === undefined) await Deno.writeFile(target, bytes);
    else await Deno.writeTextFile(target, rename(text, template.name, name));
  }
}

/** The smallest thing that is a module — a shape to start from comes from a template, not from here. */
async function blankModule(dir: string, modName: string): Promise<void> {
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(dir + "manifest.json", JSON.stringify({ name: modName, files: ["manifest.json", "plugin.ts"] }, null, 2) + "\n");
  await Deno.writeTextFile(dir + "plugin.ts", "export function init() {}\n");
}

async function create(app: App, modName: string, template: string): Promise<void> {
  if (!isModuleName(modName)) throw new Error(`Invalid module name: ${modName}`);
  if (app.modules.get(modName)) throw new Error(`Module "${modName}" exists already`);
  const dir = storeDir(app) + modName + "/";
  if (await Deno.stat(dir).then(() => true, () => false)) throw new Error(`Folder "${modName}" exists already`);

  try {
    if (!template) await blankModule(dir, modName);
    else {
      const mod = app.modules.get(template);
      if (!mod) throw new Error(`Template "${template}" is not available`);
      await copyTemplate(mod, dir, modName);
    }
    await ownStore(app).install(modName);
  } catch (e) {
    // A failed download or an unlinkable module must not block the name on the next try.
    await app.modules.uninstall(modName).catch(() => {});
    await Deno.remove(dir, { recursive: true }).catch(() => {});
    throw e;
  }
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
  const templates = Object.values(app.modules.all()).filter((mod) => mod.manifest.files?.length).map((mod) => mod.name).sort();
  const modulesPage = await (await node.cms.nodeByModule("cms.backend.superuser.module"))?.page();
  const modulesUrl = modulesPage && await modulesPage.access() ? await modulesPage.url() : "";
  const modUrl = (mod: string) => `${modulesUrl}${modulesUrl.includes("?") ? "&" : "?"}mod=${encodeURIComponent(mod)}`;

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
        <td>${modulesUrl ? html`<a href="${modUrl(mod)}">${mod}</a>` : mod}
        <td><small>${app.modules.linked(mod) ? t`active` : t`inactive`}</small>`)}
    </table>
  </div>
</div>`;
}

export const cms = {
  node: { js: ["pub/main.js"], render, api },
};
