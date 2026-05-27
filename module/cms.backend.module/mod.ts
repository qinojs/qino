import { hee } from "../core/lib/util.ts"
import { getCtx } from "../core/lib/RequestContext.ts";
import { backend } from "../cms.backend/mod.ts";
import type { Node } from "../cms/lib/Node.ts";
import type { App } from "../core/server.ts";

export const name = "cms.backend.module";
export const needs = ["cms.backend"];

export async function install({ app }: { app: App }): Promise<void> {
  const P = await backend.install(app, "cms.backend.module");
  if (P) {
    await P.title("en", "Modules");
    await P.title("de", "Module");
  }
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

async function renderDetail(node: Node, modName: string): Promise<string> {
  const app = node.app;
  const ctx = getCtx();
  const allMods = app.modules.all();
  const modObj = allMods[modName];

  if (!modObj) {
    return `<div class=u2-card>
      <div class=-head><a href="?">← Module</a></div>
      <div class=-body>${await app.t`Module`} ${hee(modName)} ${await app.t`not found.`}</div>
    </div>`;
  }

  const mod = modObj.exports;
  const isSuperuser = !!(await ctx.user?.get("superuser"));
  const modPath = modObj.path;
  const modUrl  = modObj.url;
  const modDir  = modPath?.replace(/\/?[^/]+$/, "") ?? null;

  // --- Exports ---
  const SKIP = new Set(["name", "needs", "cms", "install", "init", "routes", "dbSchema", "settingsSchema", "ctxSettingsSchema", "api"]);
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
    { key: "routes",            label: "routes()" },
    ...extraExports.map(k => ({ key: k, label: k })),
  ];
  const presentExports = knownKeys.filter(({ key }) => mod[key] !== undefined);

  const exportBadges = presentExports.map(({ key, label }) => {
    let detail = "";
    if (key === "needs") {
      detail = " <small>(" + (mod.needs as string[]).join(", ") + ")</small>";
    } else if (key === "api") {
      const routes = Object.keys(mod.api ?? {});
      detail = " <small>(" + routes.join(", ") + ")</small>";
    } else if (key === "cms") {
      const parts = Object.keys(mod.cms ?? {});
      detail = " <small>(" + parts.join(", ") + ")</small>";
    } else if (key === "settingsSchema" || key === "ctxSettingsSchema") {
      const schema = mod[key];
      const props = schema && typeof schema === "object" && "properties" in schema && schema.properties && typeof schema.properties === "object" ? Object.keys(schema.properties) : [];
      if (props.length) detail = " <small>(" + props.join(", ") + ")</small>";
    }
    return `${hee(label)}${detail} `;
  }).join("");

  // --- Dependencies (needs) ---
  const needs: string[] = mod.needs ?? [];
  const neededBy = Object.entries(allMods)
    .filter(([, m]) => (m.exports.needs ?? []).includes(modName))
    .map(([n]) => n)
    .sort();

  const depsHtml = needs.length
    ? needs.map(d => `<a href="?mod=${encodeURIComponent(d)}">${hee(d)}</a>`).join(" ")
    : "<em>none</em>";

  const neededByHtml = neededBy.length
    ? neededBy.map(d => `<a href="?mod=${encodeURIComponent(d)}">${hee(d)}</a>`).join(" ")
    : "<em>none</em>";

  // --- Files ---
  let filesHtml = "";
  if (modDir) {
    const rows: string[] = [];
    for await (const { filePath, rel } of walkDir(modDir)) {
      const info = await Deno.stat(filePath).catch(() => null);
      if (!info?.isFile) continue;
      const mtimeIso = info.mtime?.toISOString() ?? "";
      let nameCell: string;
      if (isSuperuser) {
        const href = hee(ctx.appURL + "editor?file=" + encodeURIComponent(filePath));
        nameCell = `<a href="${href}" target="${hee(encodeURIComponent(filePath))}">${hee(rel)}</a>`;
      } else {
        nameCell = hee(rel);
      }
      rows.push(`<tr>
        <td>${nameCell}
        <td style="text-align:right"><u2-bytes>${info.size}</u2-bytes>
        <td><u2-time datetime="${mtimeIso}" type=relative>${mtimeIso.slice(0, 16).replace("T", " ")}</u2-time>`);
    }
    if (rows.length) {
      filesHtml = `<table class=u2-table style="width:100%;white-space:nowrap">
        <thead><tr><th>${await app.t`File`}<th style="text-align:right">${await app.t`Size`}<th>${await app.t`Modified`}
        <tbody>${rows.join("")}
      </table>`;
    } else {
      filesHtml = `<em>${await app.t`no files found`}</em>`;
    }
  } else if (modUrl) {
    filesHtml = `<em>${await app.t`Remote module (URL):`} ${hee(modUrl)}</em>`;
  }

  // --- Source info ---
  const sourceDisplay = modPath ?? modUrl ?? "";
  const sourceHtml = isSuperuser && modPath
    ? `<a href="${hee(ctx.appURL + "editor?file=" + encodeURIComponent(modPath))}" target="${hee(encodeURIComponent(modPath))}">${hee(sourceDisplay)}</a>`
    : `<code>${hee(sourceDisplay)}</code>`;

  return `<div class=u2-flex>
  <div class=u2-card>
    <div class=-head><a href="?">← Module</a> ${hee(modName)}</div>
    <table class=u2-table>
      <tr><th>${await app.t`Source`}<td>${sourceHtml}
      <tr><th>${await app.t`Exports`}<td>${exportBadges || `<em>${await app.t`none`}</em>`}
      <tr><th>${await app.t`needs`}<td>${depsHtml}
      <tr><th>${await app.t`used by`}<td>${neededByHtml}
    </table>
  </div>
  ${mod.settingsSchema?.properties ? `
  <div class=u2-card>
    <div class=-head>${await app.t`Settings schema`}</div>
    <table class=u2-table>
      <thead><tr><th>${await app.t`Key`}<th>${await app.t`Type`}<th>${await app.t`Title`}
      <tbody>${Object.entries((mod.settingsSchema.properties ?? {}) as Record<string, Record<string, unknown>>).map(([k, v]) =>
        `<tr><td><code>${hee(k)}</code><td><code>${hee(v?.type ?? "")}</code><td>${hee(v?.title ?? "")}`
      ).join("")}
    </table>
  </div>` : ""}
  ${mod.api ? `<div class=u2-card><div class=-head>${await app.t`API routes`}</div><div class=-body><pre>${hee(JSON.stringify(flattenApiRoutes(mod.api), null, 2))}</pre></div></div>` : ""}
  <div class=u2-card>
    <div class=-head>${await app.t`Files`}${isSuperuser ? ` (${await app.t`with editor links`})` : ""}</div>
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
    const children = flattenApiRoutes(route, path);
    Object.assign(result, children);
  }
  return result;
}

async function renderOverview(node: Node): Promise<string> {
  const app = node.app;
  const ctx = getCtx();
  const rows = [];
  const allMods = app.modules.all();
  const modules = Object.keys(allMods).sort();

  for (const name of modules) {
    const modObj = allMods[name];
    const mod = modObj.exports;
    const needs: string[] = mod.needs ?? [];
    const neededBy = Object.values(allMods).filter((m) => (m.exports.needs ?? []).includes(name)).length;
    const exports = [
      mod.init && "init",
      mod.install && "install",
      mod.routes && "routes",
      mod.api && "api",
      mod.cms && "cms",
      mod.settingsSchema && "settings",
      mod.dbSchema && "db",
    ].filter(Boolean).join(", ");

    const modDir = modObj.path?.replace(/\/?[^/]+$/, "") ?? null;
    const hasSvg = modDir ? await Deno.stat(modDir + "/pub/module.svg").then(() => true, () => false) : false;
    const iconHtml = hasSvg
      ? `<svg style="display:block" width=16 height=16><use href="${ctx.sysURL}${name}/pub/module.svg#main"/></svg>`
      : "";

    rows.push(`<tr>
      <td style="padding-right:0">${iconHtml}
      <td><a href="?mod=${encodeURIComponent(name)}">${hee(name)}</a>
      <td style="text-align:center">${needs.length}
      <td style="text-align:center">${neededBy}
      <td>${hee(exports)}`);
  }

  return `<div class=u2-card>
  <div class=-head>${await app.t`Modules`}</div>
  <div class=-body>
    <input type=search placeholder="${await app.t`search`}..." style="width:300px; max-width:100%" data-module-search>
  </div>
  <div style="overflow:auto; max-height:80vh; padding:0">
    <table class=u2-table style="white-space:nowrap">
      <thead>
        <tr>
          <th width=10>
          <th>${await app.t`Name`}
          <th title="${await app.t`Number of dependencies`}">${await app.t`needs`}
          <th title="${await app.t`Required by`}">${await app.t`used by`}
          <th>${await app.t`Exports`}
      <tbody>
        ${rows.join("")}
    </table>
  </div>
</div>`;
}

function render(node: Node): Promise<string> {
  const ctx = getCtx();
  const modName = ctx.get.mod ? String(ctx.get.mod) : "";
  if (modName) return renderDetail(node, modName);
  return renderOverview(node);
}

export async function backendDashboardWidget(app: App): Promise<string> {
  const allMods = app.modules.all();
  const total = Object.keys(allMods).length;
  const withDb = Object.values(allMods).filter((m) => m.exports?.dbSchema).length;
  const withApi = Object.values(allMods).filter((m) => m.exports?.api).length;
  return `
<table class="u2-table" style="white-space:nowrap">
  <tr><td>${await app.t`Total`}:<td>${hee(String(total))}
  <tr><td>${await app.t`With DB schema`}:<td>${hee(String(withDb))}
  <tr><td>${await app.t`With API`}:<td>${hee(String(withApi))}
</table>`;
}

export const cms = {
  node: { render },
};
