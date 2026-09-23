import { toFileUrl } from "@std/path";
import { errMsg, getCtx, html, moduleIcon, requireStepUp } from "@qino/qino";
import * as u2 from "@qino/qino/u2";

import { writeIndex } from "./storeIndex.ts";

import type { App, HtmlString, Module, Store } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const name = "cms.backend.superuser.module";

// A typed URL wins, everything else is a path below the app.
const resolve = (app: App, spec: string) => new URL(spec, toFileUrl(app.dir)).href;

// Stores decide where server code may come from, so only superusers may change them — page
// access is not enough.
const isSuperuser = () => !!getCtx().user?.superuser;

// core is the root of the dependency graph, and this module renders the page you are looking at.
const LOCKED = new Set(["core", name]);

// Actions that change the running code require a fresh proof (step-up).
const GRAVE = new Set(["addStore", "removeStore", "install", "uninstall", "useSource"]);

// What is worth asking about before it happens.
const CONFIRM = new Set(["repair", "reset", "uninstall", "unlink", "useSource"]);

// Colors: red deletes a module's data, orange writes into it, green is the row's main action, blue
// marks an inactive module. Everything else stays plain.
const TONE: Record<string, string> = {
  uninstall: "-delete",
  reset: "-delete",
  repair: "-repair",
  install: "-install",
  link: "-link",
};

// Declared modules outlive any uninstall, so the page offers neither uninstall nor deactivate.
/** Icon of a module not yet imported — served by its store, so allow that origin for images. */
function remoteIcon(iconMod: { manifest: { files?: string[] }; modUrl: string }): HtmlString | undefined {
  if (!iconMod.manifest.files?.includes("pub/module.svg")) return;
  getCtx().res.csp["img-src"][iconMod.modUrl] = true;
  return html`<img src="${iconMod.modUrl}pub/module.svg" width=20 height=20 alt="" style="display:block">`;
}

const fixed = (app: App, mod: string) => LOCKED.has(mod) || app.modules.declared(mod);

type RowState = "active" | "inactive" | "available" | "broken" | "elsewhere";

/** The state of a row, which decides its actions. A row is module + store, so a module may be
 *  installed in one row and only offered in another; `Module.source` names the actual store. */
function state(app: App, mod: string, store?: Store): RowState {
  if (app.modules.failures().has(mod)) return "broken";
  const known = app.modules.get(mod);
  // No store and not imported: a module row nothing can load — like a failed import.
  if (!known) return store ? "available" : "broken";
  const mine = store ? known.source === store.moduleUrl(mod) : !offered(app, known);
  return !mine ? "elsewhere" : app.modules.linked(mod) ? "active" : "inactive";
}

/** True if the module came from a registered store (then no row without store is needed). */
const offered = (app: App, mod: Module) => app.stores.all().some((store) => store.moduleUrl(mod.name) === mod.source);

/** Short store name: host of a remote catalog, path of a local one (with parent folder; the app's
 *  own relative, to tell `./module/` from `qino/module`). */
function storeLabel(app: App, url: string): string {
  const u = new URL(url);
  if (u.host) return u.host;
  const dir = decodeURIComponent(new URL(".", url).pathname);
  const own = toFileUrl(app.dir).pathname;
  return dir.startsWith(own) ? "./" + dir.slice(own.length) : dir.split("/").filter(Boolean).slice(-2).join("/") || url;
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

/** One row per module and store; a module in two stores is listed twice. Modules without store
 *  (server.ts or installed from a URL) get one row. */
async function moduleList(app: App, cats: Awaited<ReturnType<typeof catalogs>>): Promise<{ mod: string; store?: Store }[]> {
  const rows: { mod: string; store?: Store }[] = [];
  for (const { store, names } of cats) for (const mod of names) rows.push({ mod, store });
  for (const mod of app.modules.all().values()) if (!offered(app, mod)) rows.push({ mod: mod.name });
  for (const mod of app.modules.failures().keys()) if (!rows.some((row) => row.mod === mod)) rows.push({ mod });
  // A module row neither a catalog nor an import explains (renamed or removed module). Only this
  // page can show and remove it.
  for (const { name } of await app.db.query`SELECT name FROM module`.catch(() => []))
    if (!rows.some((row) => row.mod === name)) rows.push({ mod: name });
  return rows.sort((a, b) => a.mod.localeCompare(b.mod) || (a.store?.url ?? "").localeCompare(b.store?.url ?? ""));
}

const segments = (url: string) => decodeURIComponent(new URL(url).pathname).split("/").filter(Boolean);

/** Unique store labels: on collision (same host), add the differing path segments, e.g.
 *  `gcdn.li/qino@v0.6.1`. */
function labeller(app: App): (url: string) => string {
  const groups = new Map<string, string[]>();
  for (const store of app.stores.all()) {
    const short = storeLabel(app, store.url);
    groups.set(short, [...(groups.get(short) ?? []), store.url]);
  }
  return (url) => {
    const short = storeLabel(app, url);
    const group = groups.get(short) ?? [];
    if (group.length < 2) return short;
    const others = group.map(segments);
    const own = segments(url).filter((seg, i) => !others.every((other) => other[i] === seg));
    return own.length ? `${short}/${own.join("/")}` : url.replace(/^https?:\/\//, "");
  };
}

// Keyed by action and by state, so a row picks its texts by what it is.
async function labels(app: App) {
  const t = app.t;
  const [install, uninstall, link, unlink, repair, reset, useSource, addStore, writeIndex, active, inactive, available, broken, elsewhere, noStore] = await Promise.all([
    t`Install`, t`Uninstall`, t`Activate`, t`Deactivate`, t`Repair`, t`Reset`, t`Use this source`, t`Add store`, t`Write index`,
    t`active`, t`inactive`, t`available`, t`broken`, t`installed from another store`, t`leftover entry, no store offers it`,
  ]);
  return { install, uninstall, link, unlink, repair, reset, useSource, addStore, writeIndex, active, inactive, available, broken, elsewhere, noStore };
}
type Labels = Awaited<ReturnType<typeof labels>>;
type ModAct = "install" | "uninstall" | "link" | "unlink" | "repair" | "reset" | "useSource";

// --- rows -----------------------------------------------------------------
// The row carries mod, store and state: the client reads them for its filter and its API calls.

/** Link order as name → position (only imported, unbroken modules). If the graph can't be ordered,
 *  only this column is lost. */
function ranks(app: App): Map<string, number> {
  try { return new Map(app.modules.order().map((name, i) => [name, i + 1])); } catch { return new Map(); }
}

async function moduleRow(app: App, mod: string, store: Store | undefined, l: Labels, label: (url: string) => string, rank: Map<string, number>): Promise<HtmlString> {
  const st = state(app, mod, store);
  // Every broken row says why: the import error, or that nothing offers the name any more.
  const why = st !== "broken" ? undefined : app.modules.failures().get(mod) ?? l.noStore;
  const known = app.modules.get(mod);
  const all = app.modules.all();
  const iconMod = !store || known?.source === store.moduleUrl(mod)
    ? known
    : await store.manifest(mod).then(
      (manifest) => ({ manifest, modUrl: new URL(".", store.moduleUrl(mod)).href }),
      () => undefined,
    );
  // Not-yet-imported modules have their icon at the store; `<use>` can't load cross-origin, `<img>`
  // can.
  const use = iconMod === known ? moduleIcon(known) : undefined;
  const icon = use
    ? html`<svg style="display:block" width=20 height=20 aria-hidden=true>${use}</svg>`
    : iconMod && iconMod !== known
    ? remoteIcon(iconMod)
    : undefined;
  const manifest = known?.manifest ?? iconMod?.manifest;
  const dependencies = manifest?.dependencies?.length ?? 0;
  const neededBy = [...all.values()].filter((other) => other.dependencies.includes(mod)).length;
  const description = manifest?.description ?? "";
  const detail = getCtx().req.url.toURL();
  detail.searchParams.set("mod", mod);
  const btn = (act: ModAct) =>
    html`<button data-act=${act}${TONE[act] ? html` class=${TONE[act]}` : ""}${CONFIRM.has(act) ? html` u2-confirm` : ""}>${l[act]}</button>`;
  // Re-seeding works for any linked module, also declared ones (so older installations get the
  // default set). A row of another store can't install (name taken) but can switch the source.
  const acts = st === "available"
    ? [btn("install")]
    : st === "broken"
    ? [btn("uninstall")]
    : st === "elsewhere"
    ? fixed(app, mod) ? [] : [btn("useSource")]
    : [
      ...(st === "active" ? [btn("repair"), ...(known?.plugin.uninstall ? [btn("reset")] : [])] : []),
      ...(fixed(app, mod) ? [] : [btn(st === "active" ? "unlink" : "link"), btn("uninstall")]),
    ];
  return html`<tr data-mod="${mod}" data-store="${store?.url}" data-state=${st}>
    <td style="padding-block:.1em; padding-right:0">${icon}
    <td data-value="${mod}" title="${why ?? description}">${known ? html`<a href="${detail.search}">${mod}</a>` : mod}
    <td title="${store?.url}"><small>${store ? label(store.url) : app.modules.declared(mod) ? "server.ts" : "—"}</small>
    <td>${why ? html`<strong>${l.broken}</strong><br><small>${why}</small>` : l[st]}
    <td data-value="${rank.get(mod)}" style="text-align:center"><small>${rank.get(mod)}</small>
    <td data-value="${dependencies}" style="text-align:center">${dependencies}
    <td data-value="${neededBy}" style="text-align:center">${neededBy}
    <td title="${description}" style="max-width:30rem;overflow:hidden;text-overflow:ellipsis">${description}
    <td style="text-align:right; padding-block:.1em">${html.join(acts, " ")}`;
}

function storeRow(store: Store, error: string, l: Labels, label: (url: string) => string, su: boolean): HtmlString {
  const local = store.base.startsWith("file:");
  return html`<tr>
    <td><button class=u2-unstyle data-pick="${store.url}"><code>${label(store.url)}</code><br><small>${store.url}</small></button>
    <td>${error ? html`<strong>${error}</strong>` : html`<small data-count="${store.url}"></small>`}
    <td>${local ? html`<button data-act=writeIndex data-store="${store.url}">${l.writeIndex}</button>` : ""}
    <td style="text-align:right">${
    store.declared || !su
      ? ""
      : html`<button data-act=removeStore data-store="${store.url}" class=u2-unstyle u2-confirm><u2-ico icon=delete>✕</u2-ico></button>`
  }`;
}

/** Missing dependencies (recursive) that installing `mod` from `from` would add. Read from the
 *  manifests, no import. Same lookup as install(). */
async function alsoNeeded(app: App, from: Store, mod: string): Promise<string[]> {
  const offers = await app.stores.offers();
  const found: string[] = [];
  for (const queue = [[mod, from] as const]; queue.length;) {
    const [name, store] = queue.shift()!;
    const manifest = await store.manifest(name).catch(() => undefined);
    for (const need of manifest?.dependencies ?? []) {
      if (app.modules.get(need) || found.includes(need)) continue;
      found.push(need);
      const offered = offers.get(need);
      if (offered) queue.push([need, offered]); // unresolvable; install() is where that becomes an error
    }
  }
  return found;
}

// --- node API -------------------------------------------------------------

/** Run an action; returns the updated row (null = gone), only errors have a message. Without a row
 *  the page reloads (a store was added or removed). */
export async function api(node: Node, vars: Record<string, unknown>): Promise<{ ok: boolean; message?: string; row?: string | null; needs?: string[] }> {
  const app = node.app;
  const act = String(vars.act ?? "");
  const mod = String(vars.mod ?? "");
  const store = String(vars.store ?? "");
  const target = (): Store => { // both store actions need it, and neither may guess when it is gone
    const found = app.stores.get(store);
    if (!found) throw new Error(`Unknown store: ${store}`);
    return found;
  };
  // Outside the try, so the browser gets `step_up_required`, not an ok:false message.
  if (GRAVE.has(act)) await requireStepUp(getCtx());
  try {
    switch (act) {
      case "addStore":
        if (!isSuperuser()) throw new Error("Only a superuser can add a store");
        await app.stores.install(resolve(app, store));
        return { ok: true };
      case "writeIndex":
        return { ok: true, message: await writeIndex(target()) };
      case "removeStore":
        if (!isSuperuser()) throw new Error("Only a superuser can remove a store");
        await app.stores.uninstall(store);
        return { ok: true };
      case "installPlan": // what the button is about to do, so the user can say no
        return { ok: true, needs: await alsoNeeded(app, target(), mod) };
      case "install":
        // Through the store, so the request names a store and a module — never a URL to import.
        await target().install(mod);
        return { ok: true }; // installing a dependency may reactivate other rows
      case "useSource":
        if (LOCKED.has(mod)) throw new Error(`Cannot relocate "${mod}"`);
        await app.modules.relocate(mod, target().moduleUrl(mod));
        return { ok: true }; // the row of the store it came from changes with it
      case "uninstall":
        if (LOCKED.has(mod)) throw new Error(`Cannot uninstall "${mod}"`);
        await app.modules.uninstall(mod);
        return { ok: true };
      case "repair":
        await app.modules.repair(mod);
        break;
      case "reset":
        await app.modules.reset(mod);
        break;
      case "link":
        await app.modules.link(mod);
        break;
      case "unlink":
        if (LOCKED.has(mod)) throw new Error(`Cannot deactivate "${mod}"`);
        app.modules.unlink(mod);
        break;
      default:
        throw new Error(`Unknown action: ${act}`);
    }
  } catch (e) {
    return { ok: false, message: errMsg(e) };
  }
  // Install/uninstall change the rows of other stores too, so they reload the page.
  return { ok: true, row: String(await moduleRow(app, mod, app.stores.get(store), await labels(app), labeller(app), ranks(app))) };
}

// --- view -----------------------------------------------------------------

export async function renderOverview(node: Node): Promise<HtmlString> {
  const app = node.app;
  const t = app.t;
  const l = await labels(app);
  const label = labeller(app);
  const cats = await catalogs(app);
  const mods = await moduleList(app, cats);
  const rank = ranks(app);
  const su = isSuperuser();

  return html.async`<div class="u2-flex">
  <div class=u2-card>
    <div class=-head>${t`Module stores`}</div>
    <table class=u2-table>
      ${cats.map(({ store, error }) => storeRow(store, error, l, label, su))}
      ${su ? html`<tr><td colspan=4><button data-act=addStore>${l.addStore}</button>` : ""}
    </table>
    <div><small>${t`A store is a local folder of modules, e.g. ./module/, or a store.json listing them`}</small></div>
    ${su ? "" : html.async`<div><small>${t`Only a superuser can add or remove stores — a module can be installed from the ones listed here.`}</small></div>`}
  </div>

  <div class=u2-card>
    <div class=-head>${t`Modules`}</div>
    <div class=u2-flex>
      <select data-filter=store>
        <option value="">${t`all stores`}
        ${cats.map(({ store }) => html`<option value="${store.url}">${label(store.url)}`)}
        <option value="-">${t`no store`}
      </select>
      <select data-filter=state>
        <option value="">${t`any state`}
        <option value=active>${l.active}
        <option value=inactive>${l.inactive}
        <option value=available>${l.available}
        <option value=elsewhere>${l.elsewhere}
        <option value=broken>${l.broken}
      </select>
      <input type=search autofocus data-filter=search placeholder="${t`Search`}">
    </div>
    <u2-table style="overflow:auto; max-height:70vh; padding:0">
      <table class="u2-table -Sticky" style="white-space:nowrap">
        <thead><tr>
          <th>
          <th data-sort-handler>${t`Module`}
          <th data-sort-handler>${t`Store`}
          <th data-sort-handler>${t`State`}
          <th data-sort-handler title="${t`Load order: every module comes after the ones it needs`}">${t`order`}
          <th data-sort-handler title="${t`Number of dependencies`}">${t`dependencies`}
          <th data-sort-handler title="${t`Required by`}">${t`used by`}
          <th data-sort-handler>${t`Description`}
          <th>
        <tbody>${mods.map(({ mod, store }) => moduleRow(app, mod, store, l, label, rank))}
      </table>
    </u2-table>
    <div><small>${t`Uninstalling deletes what the module keeps; deactivating only unhooks it. Repair recreates what was deleted, resetting removes it first.`}</small></div>
  </div>
</div>`;
}

/** Dashboard: counts, latest installs and inactive modules. */
export async function backendDashboardWidget(app: App): Promise<HtmlString> {
  const t = app.t;
  const mods = [...app.modules.all().keys()];
  const inactive = mods.filter((mod) => !app.modules.linked(mod));
  const broken = app.modules.failures().size;
  const latest = await app.db.query`SELECT name, installed FROM module WHERE installed > 0 ORDER BY installed DESC LIMIT 3`.catch(() => []);

  const recent = !latest.length ? "" : html.async`<table class=u2-table style="white-space:nowrap">
  <thead><tr>
    <th>${t`Recently installed`}
    <th>
  <tbody>${
    latest.map((row) => html`<tr>
    <td>${row.name}
    <td style="text-align:right">${u2.el.time(row.installed, { narrow: true })}`)
  }
</table>`;

  const sleeping = !inactive.length ? "" : html.async`<table class=u2-table style="white-space:nowrap;margin-top:1px">
  <thead><tr><th>${inactive.length} ${t`inactive`}
  <tbody>${inactive.map((mod) => html`<tr><td>${mod}`)}
</table>`;

  return html.async`<div>
  <b>${mods.length - inactive.length}</b> ${t`active`} · <b>${app.stores.all().length}</b> ${t`stores`}
  ${broken ? html.async` · <small class=u2-badge style="background:var(--red)">${broken} ${t`broken`}</small>` : ""}
</div>${recent}${sleeping}`;
}
