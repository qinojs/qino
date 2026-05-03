// deno-lint-ignore-file no-explicit-any
import { hee, getCtx } from "qg";
import { backend } from "../cms.backend/mod.ts";
import type { Node } from "../cms/lib/Node.ts";

export const name = "cms.backend.module";
export const needs = ["cms.backend"];

export async function install({ app }: any): Promise<void> {
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
  const app = node.app as any;
  const ctx = getCtx();
  const allMods = app.modules.all();
  const modObj = allMods[modName];

  if (!modObj) {
    return `<div class=c1-box>
      <div class=-head><a href="?">← Module</a></div>
      <div class=-body>Modul <code>${hee(modName)}</code> nicht gefunden.</div>
    </div>`;
  }

  const mod = modObj.exports;
  const isSuperuser = !!(await ctx.user?.get("superuser"));
  const modPath = modObj.path;
  const modUrl  = modObj.url;
  const modDir  = modPath ? modPath.replace(/\/?[^/]+$/, "") : null;

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
      const props = Object.keys((mod[key] as any)?.properties ?? {});
      if (props.length) detail = " <small>(" + props.join(", ") + ")</small>";
    }
    return `<span style="display:inline-block;background:#e9ecef;border-radius:4px;padding:2px 8px;margin:2px;font-family:monospace;font-size:13px">${hee(label)}${detail}</span>`;
  }).join("");

  // --- Dependencies (needs) ---
  const needs: string[] = mod.needs ?? [];
  const neededBy = Object.entries(allMods)
    .filter(([, m]) => ((m as any).needs ?? []).includes(modName))
    .map(([n]) => n)
    .sort();

  const depsHtml = needs.length
    ? needs.map(d => `<a href="?mod=${encodeURIComponent(d)}" style="margin:2px;display:inline-block"><code>${hee(d)}</code></a>`).join(" ")
    : "<em style='color:#999'>keine</em>";

  const neededByHtml = neededBy.length
    ? neededBy.map(d => `<a href="?mod=${encodeURIComponent(d)}" style="margin:2px;display:inline-block"><code>${hee(d)}</code></a>`).join(" ")
    : "<em style='color:#999'>keine</em>";

  // --- Files ---
  let filesHtml = "";
  if (modDir) {
    const rows: string[] = [];
    for await (const { filePath, rel } of walkDir(modDir)) {
      const info = await Deno.stat(filePath).catch(() => null);
      if (!info?.isFile) continue;
      const size = info.size < 1024 ? info.size + " B" : (info.size / 1024).toFixed(1) + " KB";
      const mtime = info.mtime ? new Date(info.mtime).toLocaleString("de") : "";
      let nameCell: string;
      if (isSuperuser) {
        const href = hee(ctx.appURL + "editor?file=" + encodeURIComponent(filePath));
        nameCell = `<a href="${href}" target="${hee(encodeURIComponent(filePath))}">${hee(rel)}</a>`;
      } else {
        nameCell = hee(rel);
      }
      rows.push(`<tr>
        <td style="font-family:monospace;font-size:12px">${nameCell}
        <td style="text-align:right;color:#999;font-size:12px;padding-right:12px">${hee(size)}
        <td style="color:#999;font-size:12px">${hee(mtime)}`);
    }
    if (rows.length) {
      filesHtml = `<table class=c1-style style="width:100%;white-space:nowrap">
        <thead><tr><th>Datei<th style="text-align:right">Größe<th>Geändert
        <tbody>${rows.join("")}
      </table>`;
    } else {
      filesHtml = "<em style='color:#999'>keine Dateien gefunden</em>";
    }
  } else if (modUrl) {
    filesHtml = `<em style='color:#999'>Remote-Modul (URL): <code>${hee(modUrl)}</code></em>`;
  }

  // --- Source info ---
  const sourceDisplay = modPath ?? modUrl ?? "";
  const sourceHtml = isSuperuser && modPath
    ? `<a href="${hee(ctx.appURL + "editor?file=" + encodeURIComponent(modPath))}" target="${hee(encodeURIComponent(modPath))}">${hee(sourceDisplay)}</a>`
    : `<code>${hee(sourceDisplay)}</code>`;

  return `<div class=c1-box>
  <div class=-head style="display:flex;align-items:center;gap:12px">
    <a href="?" style="font-size:13px;opacity:.7">← Module</a>
    <span style="font-family:monospace">${hee(modName)}</span>
  </div>

  <div class=-body style="display:grid;gap:16px;padding:16px">

    <section>
      <div style="text-transform:uppercase;letter-spacing:.08em;color:#888;margin-bottom:4px">Quelle</div>
      <div style="word-break:break-all">${sourceHtml}</div>
    </section>

    <section>
      <div style="text-transform:uppercase;letter-spacing:.08em;color:#888;margin-bottom:6px">Exports</div>
      <div>${exportBadges || "<em style='color:#999'>keine</em>"}</div>
    </section>

    <section style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div>
        <div style="text-transform:uppercase;letter-spacing:.08em;color:#888;margin-bottom:6px">Benötigt (needs)</div>
        <div>${depsHtml}</div>
      </div>
      <div>
        <div style="text-transform:uppercase;letter-spacing:.08em;color:#888;margin-bottom:6px">Wird benötigt von</div>
        <div>${neededByHtml}</div>
      </div>
    </section>

    ${mod.settingsSchema?.properties ? `<section>
      <div style="text-transform:uppercase;letter-spacing:.08em;color:#888;margin-bottom:6px">Settings-Schema</div>
      <table class=c1-style style="width:100%">
        <thead><tr><th>Key<th>Typ<th>Titel
        <tbody>${Object.entries((mod.settingsSchema as any).properties ?? {}).map(([k, v]: [string, any]) =>
          `<tr><td><code>${hee(k)}</code><td><code>${hee(v?.type ?? "")}</code><td>${hee(v?.title ?? "")}`
        ).join("")}
      </table>
    </section>` : ""}

    ${mod.api ? `<section>
      <div style="text-transform:uppercase;letter-spacing:.08em;color:#888;margin-bottom:6px">API-Routen</div>
      <div style="font-family:monospace;font-size:12px;background:#f8f9fa;padding:8px;border-radius:4px;white-space:pre-wrap">${hee(JSON.stringify(flattenApiRoutes(mod.api), null, 2))}</div>
    </section>` : ""}

    <section>
      <div style="text-transform:uppercase;letter-spacing:.08em;color:#888;margin-bottom:6px">Dateien${isSuperuser ? " (mit Editor-Links)" : ""}</div>
      ${filesHtml}
    </section>

  </div>
</div>`;
}

function flattenApiRoutes(tree: any, prefix = ""): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  const verbs = ["get", "post", "put", "delete", "patch"];
  for (const [key, val] of Object.entries(tree ?? {})) {
    const path = prefix + "/" + key;
    const methods = verbs.filter(v => (val as any)[v]);
    if (methods.length) result[path] = methods.map(m => m.toUpperCase());
    const children = flattenApiRoutes(val, path);
    Object.assign(result, children);
  }
  return result;
}

async function renderOverview(node: Node): Promise<string> {
  const app = node.app as any;
  const rows = [];
  const allMods = app.modules.all();
  const modules = Object.keys(allMods).sort();

  for (const name of modules) {
    const mod = allMods[name].exports;
    const needs: string[] = mod.needs ?? [];
    const neededBy = Object.values(allMods).filter((m: any) => (m.exports.needs ?? []).includes(name)).length;
    const exports = [
      mod.init && "init",
      mod.install && "install",
      mod.routes && "routes",
      mod.api && "api",
      mod.cms && "cms",
      mod.settingsSchema && "settings",
      mod.dbSchema && "db",
    ].filter(Boolean).join(", ");

    rows.push(`<tr>
      <td><a href="?mod=${encodeURIComponent(name)}"><code>${hee(name)}</code></a>
      <td style="text-align:center;color:#999">${needs.length}
      <td style="text-align:center;color:#999">${neededBy}
      <td style="font-size:12px;color:#888">${hee(exports)}`);
  }

  return `<div class=c1-box>
  <div class=-head>Module</div>
  <div class=-body>
    <input type=search placeholder="suchen..." style="width:300px; max-width:100%" oninput="this.closest('.c1-box').querySelectorAll('tbody tr').forEach(tr=>tr.hidden=!tr.textContent.toLowerCase().includes(this.value.toLowerCase()))">
  </div>
  <div style="overflow:auto; max-height:80vh">
    <table class=c1-style style="white-space:nowrap">
      <thead>
        <tr>
          <th>Name
          <th title="Anzahl Abhängigkeiten">needs
          <th title="Wird benötigt von">used by
          <th>Exports
      <tbody>
        ${rows.join("")}
    </table>
  </div>
</div>`;
}

async function render(node: Node): Promise<string> {
  const ctx = getCtx();
  const modName = ctx.get.mod ? String(ctx.get.mod) : "";
  if (modName) return renderDetail(node, modName);
  return renderOverview(node);
}

export const cms = {
  node: { render },
};
