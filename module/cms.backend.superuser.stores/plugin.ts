import { toFileUrl } from "@std/path";
import { html, type App, type HtmlString, type Store } from "../core/mod.ts";
import { backend, u2 } from "../cms.backend/mod.ts";
import type { Node } from "../cms/mod.ts";

export const name = "cms.backend.superuser.stores";
export const description = "Registers module stores and installs modules from their catalogs.";
export const needs = ["cms.backend"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Module stores", de: "Modul-Stores" });
}

// A typed URL wins, everything else is a path below the app.
const resolve = (app: App, spec: string) => new URL(spec, toFileUrl(app.appPATH)).href;

// core is the root of the needs graph, and this module renders the page you are looking at.
const LOCKED = new Set(["core", name]);

// What is worth asking about, and what deletes what a module keeps.
const CONFIRM = new Set(["repair", "reset", "uninstall"]);
const DESTRUCTIVE = new Set(["reset", "uninstall"]);

// Declared modules outlive any uninstall, so the page offers neither uninstall nor deactivate.
const fixed = (app: App, mod: string) => LOCKED.has(mod) || app.modules.declared(mod);

/** The one thing a row is about: everything it offers follows from this. */
function state(app: App, mod: string): "active" | "inactive" | "available" | "broken" {
  if (app.modules.failures()[mod]) return "broken";
  if (!app.modules.get(mod)) return "available";
  return app.modules.linked(mod) ? "active" : "inactive";
}

/** Short store name: the host of a remote catalog, the folder of a local one. */
function storeLabel(url: string): string {
  const u = new URL(url);
  return u.host || decodeURIComponent(u.pathname).split("/").filter(Boolean).at(-2) || url;
}

/** Read every catalog in parallel; an unreachable store keeps its error instead of names. */
function catalogs(app: App) {
  return Promise.all(app.stores.all().map((store) =>
    store.names().then(
      (names) => ({ store, names, error: "" }),
      (e) => ({ store, names: [] as string[], error: String(e?.message ?? e) }),
    )
  ));
}

/** Every module the app knows of → the store it comes from ("" = none), sorted by name. */
function moduleList(app: App, cats: Awaited<ReturnType<typeof catalogs>>): [string, string][] {
  const from = new Map<string, string>();
  for (const { store, names } of cats) {
    // The store a module is installed from wins over the first one that merely lists it.
    for (const mod of names) if (!from.has(mod) || app.modules.get(mod)?.source === store.moduleUrl(mod)) from.set(mod, store.url);
  }
  for (const mod of [...Object.keys(app.modules.all()), ...Object.keys(app.modules.failures())]) if (!from.has(mod)) from.set(mod, "");
  return [...from].sort(([a], [b]) => a.localeCompare(b));
}

// Keyed by action and by state, so a row picks its texts by what it is.
async function labels(app: App) {
  const t = app.t;
  const [install, uninstall, link, unlink, repair, reset, addStore, active, inactive, available, broken] = await Promise.all([
    t`Install`, t`Uninstall`, t`Activate`, t`Deactivate`, t`Repair`, t`Reset`, t`Add store`,
    t`active`, t`inactive`, t`available`, t`not importable`,
  ]);
  return { install, uninstall, link, unlink, repair, reset, addStore, active, inactive, available, broken };
}
type Labels = Awaited<ReturnType<typeof labels>>;
type ModAct = "install" | "uninstall" | "link" | "unlink" | "repair" | "reset";

// --- rows -----------------------------------------------------------------
// The row carries mod, store and state: the client reads them for its filter and its API calls.

function moduleRow(app: App, mod: string, storeUrl: string, l: Labels): HtmlString {
  const st = state(app, mod);
  const why = app.modules.failures()[mod];
  const plugin = app.modules.get(mod)?.plugin;
  const btn = (act: ModAct) =>
    html`<button data-act=${act}${DESTRUCTIVE.has(act) ? html` class=-delete` : ""}${CONFIRM.has(act) ? html` u2-confirm` : ""}>${l[act]}</button>`;
  // Seeding again works for anything linked, declared modules included — that is how an older
  // installation gets the default set it was never installed with.
  const acts = st === "available"
    ? [btn("install")]
    : st === "broken"
    ? [btn("uninstall")]
    : [
      ...(st === "active" ? [btn("repair"), ...(plugin?.uninstall ? [btn("reset")] : [])] : []),
      ...(fixed(app, mod) ? [] : [btn(st === "active" ? "unlink" : "link"), btn("uninstall")]),
    ];
  return html`<tr data-mod="${mod}" data-store="${storeUrl}" data-state=${st}>
    <td title="${why ?? plugin?.description}">${mod}
    <td><small>${storeUrl ? storeLabel(storeUrl) : app.modules.declared(mod) ? "server.ts" : "—"}</small>
    <td>${why ? html`<strong>${l.broken}</strong><br><small>${why}</small>` : l[st]}
    <td style="text-align:right">${html.join(acts, " ")}`;
}

function storeRow(store: Store, error: string): HtmlString {
  return html`<tr>
    <td><button class=u2-unstyle data-pick="${store.url}" title="${store.url}"><code>${storeLabel(store.url)}</code></button>
    <td>${error ? html`<strong>${error}</strong>` : html`<small data-count="${store.url}"></small>`}
    <td style="text-align:right">${
    store.declared
      ? html`<small>server.ts</small>`
      : html`<button data-act=removeStore data-store="${store.url}" class=u2-unstyle u2-confirm><u2-ico icon=delete>✕</u2-ico></button>`
  }`;
}

// --- node API -------------------------------------------------------------

/** One action, answered with the module's fresh row (null = it is gone). The new row is the
 *  feedback, so only a failure has a message. Without a row the page reloads: a store came or
 *  went, and with it its modules. */
async function api(node: Node, vars: Record<string, unknown>): Promise<{ ok: boolean; message?: string; row?: string | null }> {
  const app = node.app;
  const act = String(vars.act ?? "");
  const mod = String(vars.mod ?? "");
  const store = String(vars.store ?? "");
  try {
    switch (act) {
      case "addStore":
        await app.stores.install(resolve(app, store));
        return { ok: true };
      case "removeStore":
        await app.stores.uninstall(store);
        return { ok: true };
      case "install": {
        const from = app.stores.get(store);
        if (!from) throw new Error(`Unknown store: ${store}`);
        await app.modules.install(from.moduleUrl(mod), mod);
        return { ok: true }; // installing a dependency may reactivate other rows
      }
      case "uninstall":
        if (LOCKED.has(mod)) throw new Error(`Cannot uninstall "${mod}"`);
        await app.modules.uninstall(mod);
        break;
      case "repair":
        await app.modules.repair(mod);
        break;
      case "reset":
        await app.modules.reset(mod);
        break;
      case "link":
        await app.link(mod);
        break;
      case "unlink":
        if (LOCKED.has(mod)) throw new Error(`Cannot deactivate "${mod}"`);
        app.unlink(mod);
        break;
      default:
        throw new Error(`Unknown action: ${act}`);
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  // A module no store lists and no one knows any more has nothing left to show.
  const gone = !store && !app.modules.get(mod) && !app.modules.failures()[mod];
  return { ok: true, row: gone ? null : String(moduleRow(app, mod, store, await labels(app))) };
}

// --- view -----------------------------------------------------------------

async function render(node: Node): Promise<HtmlString> {
  const app = node.app;
  const t = app.t;
  const l = await labels(app);
  const cats = await catalogs(app);

  return html.async`<div class="u2-flex">
  <div class=u2-card>
    <div class=-head>${t`Module stores`}</div>
    <table class=u2-table>
      ${html.join(cats.map(({ store, error }) => storeRow(store, error)))}
      <tr><td colspan=3><button data-act=addStore>${l.addStore}</button>
    </table>
    <div><small>${t`A catalog is a store.json, e.g. ./qino/module/store.json`}</small></div>
  </div>

  <div class=u2-card>
    <div class=-head>${t`Modules`}</div>
    <div class=u2-flex>
      <select data-filter=store>
        <option value="">${t`all stores`}
        ${html.join(cats.map(({ store }) => html`<option value="${store.url}">${storeLabel(store.url)}`))}
        <option value="-">${t`no store`}
      </select>
      <select data-filter=state>
        <option value="">${t`any state`}
        <option value=active>${l.active}
        <option value=inactive>${l.inactive}
        <option value=available>${l.available}
        <option value=broken>${l.broken}
      </select>
      <input type=search autofocus data-filter=search placeholder="${t`Search`}">
    </div>
    <div style="overflow:auto; max-height:70vh; padding:0">
      <table class="u2-table -Sticky" style="white-space:nowrap">
        <thead><tr>
          <th>${t`Module`}
          <th>${t`Store`}
          <th>${t`State`}
          <th>
        <tbody>${html.join(moduleList(app, cats).map(([mod, store]) => moduleRow(app, mod, store, l)))}
      </table>
    </div>
    <div><small>${t`Uninstalling deletes what the module keeps; deactivating only unhooks it. Repair recreates what was deleted, resetting removes it first.`}</small></div>
  </div>
</div>`;
}

/** What is there, what came last, and the inactive modules — those are the ones you may want back. */
export async function backendDashboardWidget(app: App): Promise<HtmlString> {
  const t = app.t;
  const mods = Object.keys(app.modules.all());
  const inactive = mods.filter((mod) => !app.modules.linked(mod));
  const broken = Object.keys(app.modules.failures()).length;
  const latest = await app.db.query`SELECT name, installed FROM module WHERE installed > 0 ORDER BY installed DESC LIMIT 3`.catch(() => []);

  const recent = !latest.length ? "" : html.async`<table class=u2-table style="white-space:nowrap">
  <thead><tr>
    <th>${t`Recently installed`}
    <th>
  <tbody>${
    html.join(latest.map((row) => html`<tr>
    <td>${row.name}
    <td style="text-align:right">${u2.time(row.installed, { narrow: true })}`))
  }
</table>`;

  const sleeping = !inactive.length ? "" : html.async`<table class=u2-table style="white-space:nowrap;margin-top:1px">
  <thead><tr><th>${inactive.length} ${t`inactive`}
  <tbody>${html.join(inactive.map((mod) => html`<tr><td>${mod}`))}
</table>`;

  return html.async`<div>
  <b>${mods.length - inactive.length}</b> ${t`active`} · <b>${app.stores.all().length}</b> ${t`stores`}
  ${broken ? html.async` · <small class=u2-badge style="background:var(--red)">${broken} ${t`not importable`}</small>` : ""}
</div>${recent}${sleeping}`;
}

export const cms = {
  node: { css: ["pub/main.css"], js: ["pub/main.js"], render, api },
};
