import { fromFileUrl, resolve as resolvePath, dirname, SEPARATOR } from "@std/path";
import { errMsg, getCtx, html, moduleIcon, type App, type HtmlString } from "../core/mod.ts";
import { backend } from "../cms.backend/mod.ts";
import type { Node } from "../cms/mod.ts";
import { editorUrl } from "../fileEditor/mod.ts";
import manifest from "./manifest.json" with { type: "json" };
const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Modules", de: "Module" });
}

// dir ends with a slash (like Module.dir)
async function* walkDir(dir: string, base = dir): AsyncGenerator<{ filePath: string; rel: string }> {
  const entries = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      entries.push({ filePath: dir + entry.name, name: entry.name, isDir: entry.isDirectory });
    }
  } catch { return; }
  entries.sort((a, b) => a.filePath.localeCompare(b.filePath));
  for (const e of entries) {
    if (e.isDir) yield* walkDir(e.filePath + "/", base);
    else yield { filePath: e.filePath, rel: e.filePath.slice(base.length) };
  }
}

async function renderDetail(node: Node, modName: string): Promise<HtmlString> {
  const app = node.app;
  const t = app.t;
  const ctx = getCtx();
  const allMods = app.modules.all();
  const modObj = allMods[modName];

  const back = ctx.req.url.toURL(); back.searchParams.delete("mod");
  const backHref = back.search;

  if (!modObj) {
    return html.async`<div class=u2-card>
      <div class=-head><a href="${backHref}">← Module</a></div>
      <div class=-body>${t`Module`} ${modName} ${t`not found.`}</div>
    </div>`;
  }

  const mod = modObj.plugin;
  const isSuperuser = !!ctx.user?.superuser;
  const linked = app.modules.linked(modName);
  const error = ctx.state.moduleError as string | undefined;

  // Runtime-only enable/disable (not persisted — a restart re-links everything).
  const canToggle = isSuperuser && (!linked || !undisablable(node).has(modName));
  const toggleBtn = canToggle
    ? await html.async`<button data-mod-toggle="${linked ? "disable" : "enable"}" data-mod="${modName}">${linked ? t`Disable` : t`Enable`}</button> <small>${t`runtime only — reset on restart`}</small>`
    : "";
  const modSource = modObj.source;
  const modDir = modObj.dir ?? null;
  const modPath = modDir ? fromFileUrl(modSource) : null;

  // --- Exports ---
  const SKIP = new Set(["cms", "install", "uninstall", "init", "dbSchema", "settingsSchema", "ctxSettingsSchema", "api"]);
  const extraExports = Object.keys(mod).filter(k => !SKIP.has(k));
  const knownKeys: { key: string; label: string }[] = [
    { key: "settingsSchema",    label: "settingsSchema" },
    { key: "ctxSettingsSchema", label: "ctxSettingsSchema" },
    { key: "dbSchema",          label: "dbSchema" },
    { key: "api",               label: "api" },
    { key: "cms",               label: "cms" },
    { key: "init",              label: "init()" },
    { key: "install",           label: "install()" },
    { key: "uninstall",         label: "uninstall()" },
    ...extraExports.map(k => ({ key: k, label: k })),
  ];
  const presentExports = knownKeys.filter(({ key }) => mod[key] !== undefined);

  // the members an export contributes, shown next to its badge
  const members = (key: string): string[] => {
    if (key === "api" || key === "cms") return Object.keys(mod[key] ?? {});
    if (key !== "settingsSchema" && key !== "ctxSettingsSchema") return [];
    const props = (mod[key] as { properties?: unknown })?.properties;
    return props && typeof props === "object" ? Object.keys(props) : [];
  };
  const exportBadges = presentExports.map(({ key, label }) => {
    const list = members(key);
    return html`${label}${list.length ? html` <small>(${list.join(", ")})</small>` : ""} `;
  });

  // --- Dependencies ---
  const deps = modObj.dependencies;
  const neededBy = Object.entries(allMods)
    .filter(([, m]) => m.dependencies.includes(modName))
    .map(([n]) => n)
    .sort();

  const u = ctx.req.url.toURL();
  const modLink = (d: string) => { u.searchParams.set("mod", d); return html`<a href="${u.search}">${d}</a>`; };
  const depsHtml = deps.length ? html.join(deps.map(modLink), " ") : html.raw("<em>none</em>");
  const neededByHtml = neededBy.length ? html.join(neededBy.map(modLink), " ") : html.raw("<em>none</em>");

  // --- Files ---
  let filesHtml: HtmlString | string = "";
  let hasEditorLinks = false;
  if (modDir) {
    const rows = [];
    for await (const { filePath, rel } of walkDir(modDir)) {
      const info = await Deno.stat(filePath).catch(() => null);
      if (!info?.isFile) continue;
      const mtimeIso = info.mtime?.toISOString() ?? "";
      const url = isSuperuser ? editorUrl(filePath) : undefined;
      if (url) hasEditorLinks = true;
      const nameCell = url
        ? html`<a href="${url}" target="${encodeURIComponent(filePath)}">${rel}</a>`
        : rel;
      rows.push(html`<tr>
        <td>${nameCell}
        <td style="text-align:right"><u2-bytes>${info.size}</u2-bytes>
        <td><u2-time datetime="${mtimeIso}" type=relative>${mtimeIso.slice(0, 16).replace("T", " ")}</u2-time>`);
    }
    filesHtml = rows.length
      ? await html.async`<table class=u2-table style="width:100%;white-space:nowrap">
        <thead><tr>
          <th>${t`File`}
          <th style="text-align:right">${t`Size`}
          <th>${t`Modified`}
        <tbody>${rows}
      </table>`
      : await html.async`<em>${t`no files found`}</em>`;
  } else if (modSource) {
    filesHtml = await html.async`<em>${t`Remote module (URL):`} ${modSource}</em>`;
  }

  // --- Source info ---
  const sourceDisplay = modPath ?? modSource;
  const sourceUrl = isSuperuser && modPath ? editorUrl(modPath) : undefined;
  const sourceHtml = sourceUrl
    ? html`<a href="${sourceUrl}" target="${encodeURIComponent(modPath!)}">${sourceDisplay}</a>`
    : html`<code>${sourceDisplay}</code>`;

  return html.async`<div class=u2-flex>
  <div class=u2-card>
    <div class=-head><a href="${backHref}">← Module</a> ${modName} <small>${linked ? t`active` : t`disabled`}</small></div>
    <div class=-body>${toggleBtn}${error ? html` <strong>${error}</strong>` : ""}</div>
    <table class=u2-table>
      <tr><th>${t`Description`}<td>${modObj.description}
      <tr><th>${t`Source`}<td>${sourceHtml}
      <tr><th>${t`Exports`}<td>${exportBadges}
      <tr><th>${t`dependencies`}<td>${depsHtml}
      <tr><th>${t`used by`}<td>${neededByHtml}
    </table>
  </div>
  ${mod.settingsSchema?.properties ? html.async`
  <div class=u2-card>
    <div class=-head>${t`Settings schema`}</div>
    <table class=u2-table>
      <thead><tr>
        <th>${t`Key`}
        <th>${t`Type`}
        <th>${t`Title`}
      <tbody>${Object.entries((mod.settingsSchema.properties ?? {}) as Record<string, Record<string, unknown>>).map(([k, v]) =>
        html`<tr>
          <td><code>${k}</code>
          <td><code>${v?.type}</code>
          <td>${v?.title}`)}
    </table>
  </div>` : ""}
  ${mod.api ? html.async`<div class=u2-card><div class=-head>${t`API routes`}</div><div class=-body><pre>${JSON.stringify(flattenApiRoutes(mod.api), null, 2)}</pre></div></div>` : ""}
  <div class=u2-card>
    <div class=-head>${t`Files`}${hasEditorLinks ? html.async` (${t`with editor links`})` : ""}</div>
    ${filesHtml}
    ${modDir && isSuperuser ? html.async`<div class=-body><button data-new-file="${modName}">${t`New file`}</button></div>` : ""}
  </div>
</div>`;
}

function flattenApiRoutes(tree: Record<string, unknown> | undefined, prefix = ""): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  const verbs = ["get", "post", "put", "delete", "patch"];
  for (const [key, val] of Object.entries(tree ?? {})) {
    const path = prefix + "/" + key;
    const route = val && typeof val === "object" ? val as Record<string, unknown> : {};
    const methods = verbs.filter(v => route[v]);
    if (methods.length) result[path] = methods.map(m => m.toUpperCase());
    Object.assign(result, flattenApiRoutes(route, path));
  }
  return result;
}

async function renderOverview(node: Node): Promise<HtmlString> {
  const app = node.app;
  const t = app.t;
  const ctx = getCtx();
  const rows = [];
  const allMods = app.modules.all();
  const modules = Object.keys(allMods).sort();

  const disabledLabel = await t`disabled`;
  const u = ctx.req.url.toURL();
  for (const name of modules) {
    const modObj = allMods[name];
    const mod = modObj.plugin;
    const description = modObj.description;
    const deps = modObj.dependencies;
    const neededBy = Object.values(allMods).filter((m) => m.dependencies.includes(name)).length;
    const exports = [
      mod.init && "init",
      mod.install && "install",
      mod.api && "api",
      mod.cms && "cms",
      mod.settingsSchema && "settings",
      mod.dbSchema && "db",
    ].filter(Boolean).join(", ");

    const icon = moduleIcon(modObj);
    const iconHtml = icon ? html`<svg style="display:block" width=16 height=16>${icon}</svg>` : "";

    const disabled = !app.modules.linked(name);
    u.searchParams.set("mod", name);
    rows.push(html`<tr>
      <td style="padding-right:0">${iconHtml}
      <td data-value="${name}"><a href="${u.search}">${name}</a>${disabled ? html` <small>(${disabledLabel})</small>` : ""}
      <td data-value="${deps.length}" style="text-align:center">${deps.length}
      <td data-value="${neededBy}" style="text-align:center">${neededBy}
      <td title="${description}" style="max-width:30rem; overflow:hidden; text-overflow:ellipsis">${description}
      <td>${exports}`);
  }

  return html.async`<div class=u2-card>
  <div class=-head>${t`Modules`}</div>
  <div class=-body>
    <input type=search placeholder="${t`search`}..." style="width:18.75rem; max-width:100%" data-module-search>
  </div>
  <u2-table style="overflow:auto; max-height:80vh; padding:0">
    <table class="u2-table -Sticky" style="white-space:nowrap">
      <thead>
        <tr>
          <th width=10>
          <th width=20 data-sort-handler>${t`Name`}
          <th width=20 data-sort-handler title="${t`Number of dependencies`}">${t`dependencies`}
          <th width=20 data-sort-handler title="${t`Required by`}">${t`used by`}
          <th data-sort-handler>${t`Description`}
          <th data-sort-handler>${t`Exports`}
      <tbody>
        ${rows}
    </table>
  </u2-table>
</div>`;
}

// core must stay linked (everything needs it); the backend chain is protected by the
// dependency guard in unlink() anyway.
const PROTECTED = new Set(["core"]);

const undisablable = (node: Node) => new Set([...PROTECTED, node.vs.module]); // never unlink the module rendering this very page

// Runtime-only enable/disable: link/unlink the module. Not persisted — a restart
// re-links every imported module. Superuser only.
async function toggleModule(node: Node, vars: Record<string, unknown>): Promise<void> {
  const ctx = getCtx();
  if (!(ctx.user?.superuser)) return;
  try {
    if (vars.disable) { const n = String(vars.disable); if (!undisablable(node).has(n)) node.app.unlink(n); }
    else if (vars.enable) await node.app.link(String(vars.enable));
  } catch (e) {
    ctx.state.moduleError = errMsg(e); // shown in the detail view
  }
}

/** Create an empty file inside the module, so the editor has something to open. Superuser only. */
async function createFile(node: Node, modName: string, rel: string): Promise<void> {
  const ctx = getCtx();
  if (!(ctx.user?.superuser)) return;
  try {
    const dir = node.app.modules.get(modName)?.dir;
    if (!dir) throw new Error(`Module "${modName}" has no files here`);
    const file = resolvePath(dir, rel);
    if (!file.startsWith(resolvePath(dir) + SEPARATOR)) throw new Error(`"${rel}" is outside the module`);
    if (await Deno.stat(file).then(() => true, () => false)) throw new Error(`"${rel}" exists already`);
    await Deno.mkdir(dirname(file), { recursive: true });
    await Deno.writeTextFile(file, "");
  } catch (e) {
    ctx.state.moduleError = errMsg(e);
  }
}

async function render(node: Node, { vars = {} }: { vars?: Record<string, unknown> } = {}): Promise<HtmlString> {
  const ctx = getCtx();
  if (vars.disable || vars.enable) await toggleModule(node, vars);
  if (vars.newFile) await createFile(node, String(vars.mod ?? ""), String(vars.newFile));
  // JS reloads post vars without the ?mod= query, so keep the toggled module in view.
  const modName = String(vars.mod ?? vars.disable ?? vars.enable ?? ctx.req.query.mod ?? "");
  if (modName) return renderDetail(node, modName);
  return renderOverview(node);
}

export function backendDashboardWidget(app: App): Promise<HtmlString> {
  const mods = Object.values(app.modules.all());
  const total = mods.length;
  const withDb = mods.filter((m) => m.plugin?.dbSchema).length;
  const withApi = mods.filter((m) => m.plugin?.api).length;
  return html.async`
<table class=u2-table style="white-space:nowrap">
  <tr><td>${app.t`Total`}:<td>${total}
  <tr><td>${app.t`With DB schema`}:<td>${withDb}
  <tr><td>${app.t`With API`}:<td>${withApi}
</table>`;
}

export const cms = {
  node: { js: ["pub/main.js"], render },
};
