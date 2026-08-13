import { toFileUrl } from "@std/path";
import { errMsg, getCtx, html, moduleIcon, type App, type HtmlString, type Module, type Store } from "../core/mod.ts";
import * as u2 from "../u2/mod.ts";
import type { Node } from "../cms/mod.ts";
import { writeIndex } from "./storeIndex.ts";

const name = "cms.backend.superuser.module";

// A typed URL wins, everything else is a path below the app.
const resolve = (app: App, spec: string) => new URL(spec, toFileUrl(app.appPATH)).href;

// Which stores are registered decides where server code may be installed from — the modules below
// inherit that decision, which is why only this pair asks. Access to the page is not enough.
const isSuperuser = () => !!getCtx().user?.superuser;

// core is the root of the dependency graph, and this module renders the page you are looking at.
const LOCKED = new Set(["core", name]);

// What is worth asking about before it happens.
const CONFIRM = new Set(["repair", "reset", "uninstall", "unlink"]);

// One colour language, four things it can say: red deletes what a module keeps, orange writes into
// one, green is the single action an untouched row exists for, blue marks a module that is not
// running. Everything reversible and unremarkable stays plain — that is what keeps red readable.
const TONE: Record<string, string> = {
  uninstall: "-delete",
  reset: "-delete",
  repair: "-repair",
  install: "-install",
  link: "-link",
};

// Declared modules outlive any uninstall, so the page offers neither uninstall nor deactivate.
const fixed = (app: App, mod: string) => LOCKED.has(mod) || app.modules.declared(mod);

type RowState = "active" | "inactive" | "available" | "broken" | "elsewhere" | "orphan";

/** The one thing a row is about: everything it offers follows from this. A row is a module *and*
 *  a store, so the same module can be installed in one row and merely on offer in the next —
 *  `Module.source` says which store it actually came from, and only that row acts on it. */
function state(app: App, mod: string, store?: Store): RowState {
  if (app.modules.failures()[mod]) return "broken";
  const known = app.modules.get(mod);
  // Storeless and unimported leaves only one origin: a row in the module table nothing can load.
  if (!known) return store ? "available" : "orphan";
  const mine = store ? known.source === store.moduleUrl(mod) : !offered(app, known);
  return !mine ? "elsewhere" : app.modules.linked(mod) ? "active" : "inactive";
}

/** True when some registered store is where this module came from — then it needs no storeless row. */
const offered = (app: App, mod: Module) => app.stores.all().some((store) => store.moduleUrl(mod.name) === mod.source);

/** Short store name: the host of a remote catalog, the path of a local one. Two stores may well
 *  sit in a folder of the same name, so a local path keeps its parent, and the app's own is
 *  relative — that is what tells `./module/` from the built-in `qino/module`. */
function storeLabel(app: App, url: string): string {
  const u = new URL(url);
  if (u.host) return u.host;
  const dir = decodeURIComponent(new URL(".", url).pathname);
  const own = toFileUrl(app.appPATH).pathname;
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

/** One row per module *and* store: a module two stores offer is listed twice, once under each, so
 *  the row that says "active" is the store it was installed from. A module no store lists — added
 *  in server.ts, or installed straight from a URL — gets a single row without one. */
async function moduleList(app: App, cats: Awaited<ReturnType<typeof catalogs>>): Promise<{ mod: string; store?: Store }[]> {
  const rows: { mod: string; store?: Store }[] = [];
  for (const { store, names } of cats) for (const mod of names) rows.push({ mod, store });
  for (const mod of Object.values(app.modules.all())) if (!offered(app, mod)) rows.push({ mod: mod.name });
  for (const mod of Object.keys(app.modules.failures())) if (!rows.some((row) => row.mod === mod)) rows.push({ mod });
  // A name the table still holds that neither a catalog nor an import accounted for: the leftover of
  // a module since renamed or dropped. Boot cannot spot it — it does not know the catalogs — and no
  // other page lists it, so this is the only place it can be removed.
  for (const { name } of await app.db.query`SELECT name FROM module`.catch(() => []))
    if (!rows.some((row) => row.mod === name)) rows.push({ mod: name });
  return rows.sort((a, b) => a.mod.localeCompare(b.mod) || (a.store?.url ?? "").localeCompare(b.store?.url ?? ""));
}

const segments = (url: string) => decodeURIComponent(new URL(url).pathname).split("/").filter(Boolean);

/** Store labels for one render, unique among the listed stores: two tags of the same catalog share
 *  a host, and `gcdn.li` twice tells nobody which is which. A collision is resolved with the least
 *  that separates them — the path segments the colliding stores do *not* have in common, so two
 *  release tags read as `gcdn.li/qino@v0.6.1` rather than as two full URLs. */
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
  const [install, uninstall, link, unlink, repair, reset, addStore, writeIndex, active, inactive, available, broken, elsewhere, orphan] = await Promise.all([
    t`Install`, t`Uninstall`, t`Activate`, t`Deactivate`, t`Repair`, t`Reset`, t`Add store`, t`Write index`,
    t`active`, t`inactive`, t`available`, t`not importable`, t`installed from another store`, t`leftover entry, no store offers it`,
  ]);
  return { install, uninstall, link, unlink, repair, reset, addStore, writeIndex, active, inactive, available, broken, elsewhere, orphan };
}
type Labels = Awaited<ReturnType<typeof labels>>;
type ModAct = "install" | "uninstall" | "link" | "unlink" | "repair" | "reset";

// --- rows -----------------------------------------------------------------
// The row carries mod, store and state: the client reads them for its filter and its API calls.

async function moduleRow(app: App, mod: string, store: Store | undefined, l: Labels, label: (url: string) => string): Promise<HtmlString> {
  const st = state(app, mod, store);
  const why = app.modules.failures()[mod];
  const known = app.modules.get(mod);
  const all = app.modules.all();
  const iconMod = !store || known?.source === store.moduleUrl(mod)
    ? known
    : await store.manifest(mod).then(
      (manifest) => ({ manifest, modUrl: new URL(".", store.moduleUrl(mod)).href }),
      () => undefined,
    );
  const icon = moduleIcon(iconMod);
  const manifest = known?.manifest ?? iconMod?.manifest;
  const dependencies = manifest?.dependencies?.length ?? 0;
  const neededBy = Object.values(all).filter((other) => other.dependencies.includes(mod)).length;
  const description = manifest?.description ?? "";
  const detail = getCtx().req.url.toURL();
  detail.searchParams.set("mod", mod);
  const btn = (act: ModAct) =>
    html`<button data-act=${act}${TONE[act] ? html` class=${TONE[act]}` : ""}${CONFIRM.has(act) ? html` u2-confirm` : ""}>${l[act]}</button>`;
  // Seeding again works for anything linked, declared modules included — that is how an older
  // installation gets the default set it was never installed with. A row for a store the module did
  // not come from offers nothing: installing it again would collide with the name already taken.
  const acts = st === "available"
    ? [btn("install")]
    : st === "broken" || st === "orphan"
    ? [btn("uninstall")]
    : st === "elsewhere"
    ? []
    : [
      ...(st === "active" ? [btn("repair"), ...(known?.plugin.uninstall ? [btn("reset")] : [])] : []),
      ...(fixed(app, mod) ? [] : [btn(st === "active" ? "unlink" : "link"), btn("uninstall")]),
    ];
  return html`<tr data-mod="${mod}" data-store="${store?.url ?? ""}" data-state=${st}>
    <td style="padding-right:0">${icon ? html`<svg style="display:block" width=20 height=20 aria-hidden=true>${icon}</svg>` : ""}
    <td data-value="${mod}" title="${why ?? description}">${known ? html`<a href="${detail.search}">${mod}</a>` : mod}
    <td title="${store?.url}"><small>${store ? label(store.url) : app.modules.declared(mod) ? "server.ts" : "—"}</small>
    <td>${why ? html`<strong>${l.broken}</strong><br><small>${why}</small>` : l[st]}
    <td data-value="${dependencies}" style="text-align:center">${dependencies}
    <td data-value="${neededBy}" style="text-align:center">${neededBy}
    <td title="${description}" style="max-width:30rem;overflow:hidden;text-overflow:ellipsis">${description}
    <td style="text-align:right; padding-block:0">${html.join(acts, " ")}`;
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

/** What installing `mod` from `from` would bring along: its missing dependencies, theirs, and so on.
 *  Read from the manifests, so it costs no import — this answers a question, it decides nothing.
 *  Same walk as install(): the row's store for the module itself, whoever offers it for the rest. */
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

/** One action, answered with the module's fresh row (null = it is gone). The new row is the
 *  feedback, so only a failure has a message. Without a row the page reloads: a store came or
 *  went, and with it its modules. */
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
  // Installing or removing a module changes the rows of every *other* store offering it too, so
  // those two reload the page; the rest only ever touch their own row.
  return { ok: true, row: String(await moduleRow(app, mod, app.stores.get(store), await labels(app), labeller(app))) };
}

// --- view -----------------------------------------------------------------

export async function renderOverview(node: Node): Promise<HtmlString> {
  const app = node.app;
  const t = app.t;
  const l = await labels(app);
  const label = labeller(app);
  const cats = await catalogs(app);
  const mods = await moduleList(app, cats);
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
        <option value=orphan>${l.orphan}
      </select>
      <input type=search autofocus data-filter=search placeholder="${t`Search`}">
    </div>
    <div style="overflow:auto; max-height:70vh; padding:0">
      <table class="u2-table -Sticky" style="white-space:nowrap">
        <thead><tr>
          <th>
          <th>${t`Module`}
          <th>${t`Store`}
          <th>${t`State`}
          <th data-sort-handler title="${t`Number of dependencies`}">${t`dependencies`}
          <th data-sort-handler title="${t`Required by`}">${t`used by`}
          <th data-sort-handler>${t`Description`}
          <th>
        <tbody>${mods.map(({ mod, store }) => moduleRow(app, mod, store, l, label))}
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
  ${broken ? html.async` · <small class=u2-badge style="background:var(--red)">${broken} ${t`not importable`}</small>` : ""}
</div>${recent}${sleeping}`;
}
