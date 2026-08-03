import { toFileUrl } from "@std/path";
import { html, type App, type HtmlString, type Store } from "../core/mod.ts";
import { backend } from "../cms.backend/mod.ts";
import type { Node } from "../cms/mod.ts";

export const name = "cms.backend.superuser.stores";
export const description = "Registers module stores and installs modules from their catalogs.";
export const needs = ["cms.backend"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Module stores", de: "Modul-Stores" });
}

/** Like core's store loader, but over fetch — which reads file: and http(s): alike. */
async function catalog(url: string): Promise<string[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  const modules = (await res.json())?.modules;
  if (!modules || typeof modules !== "object" || Array.isArray(modules)) throw new Error(`${url}: modules must be an object`);
  return Object.keys(modules).sort();
}

// The catalog URL is the base; a module lives beside it under its own name (core's convention).
const moduleUrl = (store: string, mod: string) => new URL(`${mod}/plugin.ts`, new URL(".", store)).href;

// A typed URL wins, everything else is a path below the app.
const resolve = (app: App, spec: string) => new URL(spec, toFileUrl(app.appPATH)).href;

// core is the root of the needs graph, and this module renders the page you are looking at.
const locked = new Set(["core", name]);

// --- actions --------------------------------------------------------------

async function act(app: App, vars: Record<string, unknown>): Promise<string | undefined> {
  const store = String(vars.store ?? "");
  const mod = String(vars.mod ?? "");
  try {
    switch (vars.act) {
      case "addStore": {
        const url = resolve(app, store);
        await catalog(url); // no catalog, no store
        await app.stores.install(url);
        break;
      }
      case "removeStore":
        await app.stores.uninstall(store);
        break;
      case "install":
        await app.modules.install(moduleUrl(store, mod), mod);
        break;
      case "uninstall":
        if (!locked.has(mod)) await app.modules.uninstall(mod);
        break;
      case "link":
        await app.link(mod);
        break;
      case "unlink":
        if (!locked.has(mod)) app.unlink(mod);
        break;
    }
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

// --- view -----------------------------------------------------------------

async function renderStore(app: App, store: Store, names: string[] | string): Promise<HtmlString> {
  const t = app.t;
  const url = store.url;
  if (typeof names === "string") {
    return html.async`<div class=u2-card>
      <div class=-head><code>${url}</code></div>
      <div class=-body><strong>${names}</strong></div>
    </div>`;
  }

  // the row labels are plain strings: a `html` fragment is synchronous, only html.async awaits
  const [install, uninstall, activate, deactivate, active, inactive, broken] = await Promise.all([t`Install`, t`Uninstall`, t`Activate`, t`Deactivate`, t`active`, t`inactive`, t`not importable`]);
  const failures = app.modules.failures();
  const rows = names.map((mod) => {
    const linked = app.modules.linked(mod);
    const imported = !!app.modules.get(mod);
    const failed = failures[mod];
    const fixed = locked.has(mod) || app.modules.declared(mod);
    const toggle = !imported || fixed
      ? ""
      : linked
      ? html`<button data-act=unlink data-mod="${mod}">${deactivate}</button>`
      : html`<button data-act=link data-mod="${mod}">${activate}</button>`;
    const action = !imported && !failed
      ? html`<button data-act=install data-mod="${mod}" data-store="${url}">${install}</button>`
      : fixed
      ? ""
      : html`<button data-act=uninstall data-mod="${mod}" u2-confirm>${uninstall}</button>`;
    return html`<tr>
      <td>${mod}
      <td>${failed ? html`<strong title="${failed}">${broken}</strong>` : !imported ? "" : linked ? active : inactive}
      <td style="text-align:right">${toggle} ${action}`;
  });

  const installed = names.filter((mod) => app.modules.get(mod)).length;
  const origin = store.declared
    ? html`<small>${await t`from server.ts`}</small>`
    : html`<button data-act=removeStore data-store="${url}" class=u2-unstyle u2-confirm><u2-ico icon=delete>✕</u2-ico></button>`;
  return html.async`<div class=u2-card>
  <div class=-head>
    <code>${url}</code>
    <small style="margin-left:auto">${installed}/${names.length}</small>
    ${origin}
  </div>
  <div style="overflow:auto; max-height:60vh; padding:0">
    <table class=u2-table style="white-space:nowrap; width:100%">
      <thead><tr>
        <th>${t`Module`}
        <th>${t`State`}
        <th>
      <tbody>${html.join(rows)}
    </table>
  </div>
</div>`;
}

async function render(node: Node, { vars = {} }: { vars?: Record<string, unknown> } = {}): Promise<HtmlString> {
  const app = node.app;
  const t = app.t;
  const error = Object.keys(vars).length ? await act(app, vars) : undefined;
  const uninstallLabel = await t`Uninstall`;
  const list = app.stores.all();
  const catalogs = await Promise.all(list.map((store) => catalog(store.url).catch((e) => String(e.message ?? e))));
  const cards = await Promise.all(list.map((store, i) => renderStore(app, store, catalogs[i])));

  // Modules whose row survived their store — otherwise they would have no place to be uninstalled.
  const listed = new Set(catalogs.flatMap((names) => typeof names === "string" ? [] : names));
  const orphans = Object.entries(app.modules.failures()).filter(([mod]) => !listed.has(mod));

  return html.async`<div class=u2-flex style="flex-direction:column">
  <div class=u2-card>
    <div class=-head>${t`Module stores`}</div>
    <div class=-body>
      <button data-act=addStore>${t`Add store`}</button>
      <small>${t`Uninstalling deletes what the module keeps; deactivating only unhooks it.`}</small>
      ${error ? html` <strong>${error}</strong>` : ""}
    </div>
    ${list.length ? "" : html.async`<div class=-body><em>${t`No store added yet. A catalog is a store.json, e.g. ./qino/module/store.json`}</em></div>`}
  </div>
  ${orphans.length ? html.async`<div class=u2-card>
    <div class=-head>${t`Installed, not importable`}</div>
    <table class=u2-table>${html.join(orphans.map(([mod, why]) =>
      html`<tr>
        <td>${mod}
        <td><small>${why}</small>
        <td style="text-align:right"><button data-act=uninstall data-mod="${mod}" u2-confirm>${uninstallLabel}</button>`))}
    </table>
  </div>` : ""}
  ${html.join(cards)}
</div>`;
}

export const cms = {
  node: { js: ["pub/main.js"], render },
};
