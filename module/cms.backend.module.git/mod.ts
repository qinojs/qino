import { hee } from "../core/lib/util.ts"
import { getCtx } from "../core/lib/RequestContext.ts";
import { backend } from "../cms.backend/mod.ts";
import { getModuleGitInfo } from "../git/mod.ts";
import * as GitService from "../git/lib/GitService.ts";
import type { Node } from "../cms/lib/Node.ts";
import type { App } from "../core/server.ts";

export const name = "cms.backend.module.git";
export const needs = ["cms.backend", "git"];

export async function install({ app }: { app: App }): Promise<void> {
  const P = await backend.install(app, "cms.backend.module.git");
  if (P) {
    await P.title("en", "Module Git");
    await P.title("de", "Module Git");
  }
}

async function renderInstallForm(isSuperuser: boolean): Promise<string> {
  if (!isSuperuser) return "";
  return `<div class=u2-card>
  <div class=-head>Install module (Git)</div>
  <div class=-body style="padding:16px;display:grid;gap:12px">
    <div style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end">
      <div>
        <label style="font-size:12px;color:#888;display:block;margin-bottom:4px">Git URL</label>
        <input id=git-install-url type=url placeholder="https://github.com/user/my-module.git" style="width:100%;box-sizing:border-box">
      </div>
      <button id=git-install-btn class=c1-btn>Install</button>
    </div>
    <div id=git-install-out style="font-family:monospace;font-size:12px;color:#555;display:none;background:#f8f9fa;padding:8px;border-radius:4px;white-space:pre-wrap"></div>
  </div>
</div>`;
}

async function renderModuleGitSection(app: App, modName: string, isSuperuser: boolean): Promise<string> {
  const { gitRoot, info } = await getModuleGitInfo(app, modName);
  if (!gitRoot) return "";

  const statusColor = info?.dirty ? "#e67" : "#2a7";
  const statusText = info?.dirty ? "dirty" : "clean";
  const aheadBehind = info ? `↑${info.ahead} ↓${info.behind}` : "";

  const [log, tags] = await Promise.all([
    GitService.getLog(gitRoot, 20),
    GitService.getTags(gitRoot),
  ]);

  const versionOptions = [
    ...tags.map(t => `<option value=${JSON.stringify(hee(t))}>tag: ${hee(t)}`),
    ...log.map(c => `<option value=${JSON.stringify(hee(c.hash))}>${hee(c.shortHash)} ${hee(c.message.slice(0, 60))}`),
  ].join("");

  const encodedMod = JSON.stringify(modName);

  return `<section>
  <div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#888;margin-bottom:8px">Git</div>
  <div style="display:grid;gap:8px">

    <div style="display:flex;gap:16px;align-items:center;font-size:13px;font-family:monospace;background:#f8f9fa;padding:8px 12px;border-radius:4px">
      <span>branch: <strong>${hee(info?.branch ?? "?")}</strong></span>
      <span style="color:${statusColor}">● ${statusText}</span>
      ${aheadBehind ? `<span style="color:#888">${aheadBehind}</span>` : ""}
      <span style="color:#aaa;font-size:11px">${hee(gitRoot)}</span>
    </div>

    ${info?.dirty && info.files.length ? `<details style="font-size:12px">
      <summary style="cursor:pointer;color:#888">Changed files (${info.files.length})</summary>
      <div style="font-family:monospace;font-size:11px;padding:6px 0">
        ${info.files.map(f => `<div><span style="color:#e67;margin-right:8px">${hee(f.status)}</span>${hee(f.path)}</div>`).join("")}
      </div>
    </details>` : ""}

    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class=c1-btn data-git-action="pull" data-git-mod=${encodedMod}>↓ Pull</button>
      ${isSuperuser ? `<button class=c1-btn data-git-action="push" data-git-mod=${encodedMod}>↑ Push</button>` : ""}
    </div>

    ${versionOptions ? `<div style="display:flex;gap:8px;align-items:center">
      <select id="git-ref-${hee(modName)}" style="flex:1;max-width:400px">
        <option value="">— Select version —
        ${versionOptions}
      </select>
      ${isSuperuser ? `<button class=c1-btn data-git-checkout=${encodedMod}>Check out</button>` : ""}
    </div>` : ""}

    <div id="git-out-${hee(modName)}" style="font-family:monospace;font-size:12px;display:none;background:#f8f9fa;padding:8px;border-radius:4px;white-space:pre-wrap"></div>
  </div>
</section>`;
}

async function renderOverview(node: Node): Promise<string> {
  const app = node.app;
  const ctx = getCtx();
  const isSuperuser = !!(await ctx.user?.get("superuser"));
  const allMods = app.modules.all();
  const modules = Object.keys(allMods).sort();

  const rows: string[] = [];
  for (const modName of modules) {
    const modPath = app.modules.get(modName)?.path;
    if (!modPath) continue;
    const dir = modPath.replace(/\/?[^/]+$/, "");
    const gitRoot = await GitService.findGitRoot(dir);
    if (!gitRoot) continue;

    const info = await GitService.getStatus(gitRoot);
    const statusColor = info.dirty ? "#e67" : "#2a7";
    rows.push(`<tr>
      <td><a href="?mod=${encodeURIComponent(modName)}"><code>${hee(modName)}</code></a>
      <td style="font-family:monospace;font-size:12px">${hee(info.branch)}
      <td style="color:${statusColor};font-size:12px">● ${info.dirty ? "dirty" : "clean"}
      <td style="font-size:12px;color:#888">${hee(gitRoot)}`);
  }

  const installForm = await renderInstallForm(isSuperuser);

  if (!rows.length) {
    return `<div class="u2-flex -m-cms-backend-module-git">
<div class=u2-card>
  <div class=-head>Module Git</div>
  <div class=-body>No modules with Git repository found.</div>
</div>${installForm}</div>`;
  }

  return `<div class="u2-flex -m-cms-backend-module-git">
<div class=u2-card>
  <div class=-head>Module Git</div>
  <div style="overflow:auto; padding:0">
    <table class=u2-table style="white-space:nowrap;width:100%">
      <thead><tr><th>Module<th>Branch<th>Status<th>Repo
      <tbody>${rows.join("")}
    </table>
  </div>
</div>${installForm}</div>`;
}

async function renderDetail(node: Node, modName: string): Promise<string> {
  const app = node.app;
  const ctx = getCtx();
  const isSuperuser = !!(await ctx.user?.get("superuser"));

  const gitSection = await renderModuleGitSection(app, modName, isSuperuser);

  if (!gitSection) {
    return `<div class="-m-cms-backend-module-git u2-card">
  <div class=-head style="display:flex;align-items:center;gap:12px">
    <a href="?" style="font-size:13px;opacity:.7">← Module Git</a>
    <span style="font-family:monospace">${hee(modName)}</span>
  </div>
  <div class=-body style="padding:16px;color:#999">No Git repository found for this module.</div>
</div>`;
  }

  return `<div class="-m-cms-backend-module-git u2-card">
  <div class=-head style="display:flex;align-items:center;gap:12px">
    <a href="?" style="font-size:13px;opacity:.7">← Module Git</a>
    <span style="font-family:monospace">${hee(modName)}</span>
  </div>
  <div class=-body style="display:grid;gap:16px;padding:16px">
    ${gitSection}
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
  node: { js: ["pub/main.js"], render },
};
