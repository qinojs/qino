import { html, type HtmlString, getCtx, type App } from "../core/mod.ts";
import { backend } from "../cms.backend/mod.ts";
import type { Node } from "../cms/mod.ts";

export const name = "cms.backend.module";
export const needs = ["cms.backend"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, "cms.backend.module", { en: "Modules", de: "Module" });
}

async function* walkDir(dir: string, base = dir): AsyncGenerator<{ filePath: string; rel: string }> {
  const entries: { filePath: string; name: string; isDir: boolean }[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      entries.push({ filePath: dir + "/" + entry.name, name: entry.name, isDir: entry.isDirectory });
    }
  } catch { return; }
  entries.sort((a, b) => a.filePath.localeCompare(b.filePath));
  for (const e of entries) {
    if (e.isDir) yield* walkDir(e.filePath, base);
    else yield { filePath: e.filePath, rel: e.filePath.slice(base.length + 1) };
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
  const isSuperuser = !!(await ctx.user?.get("superuser"));
  const modPath = modObj.path;
  const modUrl  = modObj.url;
  const modDir  = modPath?.replace(/\/?[^/]+$/, "") ?? null;

  // --- Exports ---
  const SKIP = new Set(["name", "needs", "cms", "install", "init", "dbSchema", "settingsSchema", "ctxSettingsSchema", "api"]);
  const extraExports = Object.keys(mod).filter(k => !SKIP.has(k));
  const knownKeys: { key: string; label: string }[] = [
    { key: "needs",             label: "needs" },
    { key: "settingsSchema",    label: "settingsSchema" },
    { key: "ctxSettingsSchema", label: "ctxSettingsSchema" },
    { key: "dbSchema",          label: "dbSchema" },
    { key: "api",               label: "api" },
    { key: "cms",               label: "cms" },
    { key: "init",              label: "init()" },
    { key: "install",           label: "install()" },
    ...extraExports.map(k => ({ key: k, label: k })),
  ];
  const presentExports = knownKeys.filter(({ key }) => mod[key] !== undefined);

  const exportBadges = html.join(presentExports.map(({ key, label }) => {
    let detail: HtmlString | string = "";
    if (key === "needs") {
      detail = html` <small>(${mod.needs!.join(", ")})</small>`;
    } else if (key === "api") {
      detail = html` <small>(${Object.keys(mod.api ?? {}).join(", ")})</small>`;
    } else if (key === "cms") {
      detail = html` <small>(${Object.keys(mod.cms ?? {}).join(", ")})</small>`;
    } else if (key === "settingsSchema" || key === "ctxSettingsSchema") {
      const schema = mod[key];
      const props = schema && typeof schema === "object" && "properties" in schema && schema.properties && typeof schema.properties === "object" ? Object.keys(schema.properties) : [];
      if (props.length) detail = html` <small>(${props.join(", ")})</small>`;
    }
    return html`${label}${detail} `;
  }));

  // --- Dependencies (needs) ---
  const needs = mod.needs ?? [];
  const neededBy = Object.entries(allMods)
    .filter(([, m]) => (m.plugin.needs ?? []).includes(modName))
    .map(([n]) => n)
    .sort();

  const u = ctx.req.url.toURL();
  const modLink = (d: string) => { u.searchParams.set("mod", d); return html`<a href="${u.search}">${d}</a>`; };
  const depsHtml = needs.length ? html.join(needs.map(modLink), " ") : html.raw("<em>none</em>");
  const neededByHtml = neededBy.length ? html.join(neededBy.map(modLink), " ") : html.raw("<em>none</em>");

  // --- Files ---
  let filesHtml: HtmlString | string = "";
  if (modDir) {
    const rows: HtmlString[] = [];
    for await (const { filePath, rel } of walkDir(modDir)) {
      const info = await Deno.stat(filePath).catch(() => null);
      if (!info?.isFile) continue;
      const mtimeIso = info.mtime?.toISOString() ?? "";
      const nameCell = isSuperuser
        ? html`<a href="${ctx.req.basePath + "editor?file=" + encodeURIComponent(filePath)}" target="${encodeURIComponent(filePath)}">${rel}</a>`
        : rel;
      rows.push(html`<tr>
        <td>${nameCell}
        <td style="text-align:right"><u2-bytes>${info.size}</u2-bytes>
        <td><u2-time datetime="${mtimeIso}" type=relative>${mtimeIso.slice(0, 16).replace("T", " ")}</u2-time>`);
    }
    filesHtml = rows.length
      ? await html.async`<table class=u2-table style="width:100%;white-space:nowrap">
        <thead><tr><th>${t`File`}<th style="text-align:right">${t`Size`}<th>${t`Modified`}
        <tbody>${html.join(rows)}
      </table>`
      : await html.async`<em>${t`no files found`}</em>`;
  } else if (modUrl) {
    filesHtml = await html.async`<em>${t`Remote module (URL):`} ${modUrl}</em>`;
  }

  // --- Source info ---
  const sourceDisplay = modPath ?? modUrl ?? "";
  const sourceHtml = isSuperuser && modPath
    ? html`<a href="${ctx.req.basePath + "editor?file=" + encodeURIComponent(modPath)}" target="${encodeURIComponent(modPath)}">${sourceDisplay}</a>`
    : html`<code>${sourceDisplay}</code>`;

  return html.async`<div class=u2-flex>
  <div class=u2-card>
    <div class=-head><a href="${backHref}">← Module</a> ${modName}</div>
    <table class=u2-table>
      <tr><th>${t`Source`}<td>${sourceHtml}
      <tr><th>${t`Exports`}<td>${exportBadges}
      <tr><th>${t`needs`}<td>${depsHtml}
      <tr><th>${t`used by`}<td>${neededByHtml}
    </table>
  </div>
  ${mod.settingsSchema?.properties ? html.async`
  <div class=u2-card>
    <div class=-head>${t`Settings schema`}</div>
    <table class=u2-table>
      <thead><tr><th>${t`Key`}<th>${t`Type`}<th>${t`Title`}
      <tbody>${html.join(Object.entries((mod.settingsSchema.properties ?? {}) as Record<string, Record<string, unknown>>).map(([k, v]) =>
        html`<tr><td><code>${k}</code><td><code>${v?.type}</code><td>${v?.title}`))}
    </table>
  </div>` : ""}
  ${mod.api ? html.async`<div class=u2-card><div class=-head>${t`API routes`}</div><div class=-body><pre>${JSON.stringify(flattenApiRoutes(mod.api), null, 2)}</pre></div></div>` : ""}
  <div class=u2-card>
    <div class=-head>${t`Files`}${isSuperuser ? html.async` (${t`with editor links`})` : ""}</div>
    ${filesHtml}
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
  const rows: HtmlString[] = [];
  const allMods = app.modules.all();
  const modules = Object.keys(allMods).sort();

  const u = ctx.req.url.toURL();
  for (const name of modules) {
    const modObj = allMods[name];
    const mod = modObj.plugin;
    const needs = mod.needs ?? [];
    const neededBy = Object.values(allMods).filter((m) => (m.plugin.needs ?? []).includes(name)).length;
    const exports = [
      mod.init && "init",
      mod.install && "install",
      mod.api && "api",
      mod.cms && "cms",
      mod.settingsSchema && "settings",
      mod.dbSchema && "db",
    ].filter(Boolean).join(", ");

    const modDir = modObj.path?.replace(/\/?[^/]+$/, "") ?? null;
    const hasSvg = modDir ? await Deno.stat(modDir + "/pub/module.svg").then(() => true, () => false) : false;
    const iconHtml = hasSvg
      ? html`<svg style="display:block" width=16 height=16><use href="${ctx.req.modulePath}${name}/pub/module.svg#main"/></svg>`
      : "";

    u.searchParams.set("mod", name);
    rows.push(html`<tr>
      <td style="padding-right:0">${iconHtml}
      <td><a href="${u.search}">${name}</a>
      <td style="text-align:center">${needs.length}
      <td style="text-align:center">${neededBy}
      <td>${exports}`);
  }

  return html.async`<div class=u2-card>
  <div class=-head>${t`Modules`}</div>
  <div class=-body>
    <input type=search placeholder="${t`search`}..." style="width:300px; max-width:100%" data-module-search>
  </div>
  <div style="overflow:auto; max-height:80vh; padding:0">
    <table class=u2-table style="white-space:nowrap">
      <thead>
        <tr>
          <th width=10>
          <th>${t`Name`}
          <th title="${t`Number of dependencies`}">${t`needs`}
          <th title="${t`Required by`}">${t`used by`}
          <th>${t`Exports`}
      <tbody>
        ${html.join(rows)}
    </table>
  </div>
</div>`;
}

function render(node: Node): Promise<HtmlString> {
  const ctx = getCtx();
  const modName = ctx.req.query.mod ? String(ctx.req.query.mod) : "";
  if (modName) return renderDetail(node, modName);
  return renderOverview(node);
}

export function backendDashboardWidget(app: App): Promise<HtmlString> {
  const mods = Object.values(app.modules.all());
  const total = mods.length;
  const withDb = mods.filter((m) => m.plugin?.dbSchema).length;
  const withApi = mods.filter((m) => m.plugin?.api).length;
  return html.async`
<table class="u2-table" style="white-space:nowrap">
  <tr><td>${app.t`Total`}:<td>${total}
  <tr><td>${app.t`With DB schema`}:<td>${withDb}
  <tr><td>${app.t`With API`}:<td>${withApi}
</table>`;
}

export const cms = {
  node: { js: ["pub/main.js"], render },
};
