import { hee, getCtx, type App } from "../core/mod.ts";
import { backend } from "../cms.backend/mod.ts";
import { getModuleGitInfo, GitService } from "../git/mod.ts";
import type { Node } from "../cms/mod.ts";

export const name = "cms.backend.module.git";
export const needs = ["cms.backend", "git"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, "cms.backend.module.git", { en: "Module Git", de: "Module Git" });
}

function renderInstallForm(isSuperuser: boolean): string {
  if (!isSuperuser) return "";
  return `<div class=u2-card>
  <div class=-head>Install module (Git)</div>
  <div class="-body -install">
    <div class=-install-row>
      <div>
        <label class=-label>Git URL</label>
        <input id=git-install-url class=-input type=url placeholder="https://github.com/user/my-module.git">
      </div>
      <button id=git-install-btn class=c1-btn>Install</button>
    </div>
    <div id=git-install-out class=-out></div>
  </div>
</div>`;
}

async function renderModuleGitSection(app: App, modName: string, isSuperuser: boolean): Promise<string> {
  const { gitRoot, info } = await getModuleGitInfo(app, modName);
  if (!gitRoot) return "";

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

  return `<section class=-section>
  <div class=-section-title>Git</div>

    <div class=-bar>
      <span>branch: <strong>${hee(info?.branch ?? "?")}</strong></span>
      <span class="-state -${statusText}">● ${statusText}</span>
      ${aheadBehind ? `<span class=-ahead>${aheadBehind}</span>` : ""}
      <span class=-root>${hee(gitRoot)}</span>
    </div>

    ${info?.dirty && info.files.length ? `<details class=-files>
      <summary>Changed files (${info.files.length})</summary>
      <div class=-files-list>
        ${info.files.map(f => `<div><span class=-fstatus>${hee(f.status)}</span>${hee(f.path)}</div>`).join("")}
      </div>
    </details>` : ""}

    <div class=-actions>
      <button class=c1-btn data-git-action="pull" data-git-mod=${encodedMod}>↓ Pull</button>
      ${isSuperuser ? `<button class=c1-btn data-git-action="push" data-git-mod=${encodedMod}>↑ Push</button>` : ""}
    </div>

    ${versionOptions ? `<div class=-versions>
      <select id="git-ref-${hee(modName)}">
        <option value="">— Select version —
        ${versionOptions}
      </select>
      ${isSuperuser ? `<button class=c1-btn data-git-checkout=${encodedMod}>Check out</button>` : ""}
    </div>` : ""}

    <div id="git-out-${hee(modName)}" class=-out></div>
</section>`;
}

async function renderOverview(node: Node): Promise<string> {
  const app = node.app;
  const ctx = getCtx();
  const isSuperuser = !!(await ctx.user?.get("superuser"));
  const allMods = app.modules.all();
  const modules = Object.keys(allMods).sort();

  const found = await Promise.all(modules.map(async modName => {
    const modPath = app.modules.get(modName)?.path;
    const gitRoot = modPath && await GitService.findGitRoot(modPath.replace(/\/?[^/]+$/, ""));
    if (!gitRoot) return "";
    const info = await GitService.getStatus(gitRoot);
    const state = info.dirty ? "dirty" : "clean";
    const u = ctx.url; u.searchParams.set("mod", modName);
    return `<tr>
      <td><a href="${hee(u.search)}"><code>${hee(modName)}</code></a>
      <td class=-mono>${hee(info.branch)}
      <td class="-state -${state}">● ${state}
      <td class=-root>${hee(gitRoot)}`;
  }));
  const rows = found.filter(Boolean);

  const installForm = renderInstallForm(isSuperuser);

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
  <div class=-table-wrap>
    <table class=u2-table>
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

  const u = ctx.url; u.searchParams.delete("mod");
  const backHref = hee(u.search);

  if (!gitSection) {
    return `<div class="-m-cms-backend-module-git u2-card">
  <div class="-head -detail-head">
    <a href="${backHref}" class=-back>← Module Git</a>
    <span class=-mono>${hee(modName)}</span>
  </div>
  <div class="-body -muted">No Git repository found for this module.</div>
</div>`;
  }

  return `<div class="-m-cms-backend-module-git u2-card">
  <div class="-head -detail-head">
    <a href="${backHref}" class=-back>← Module Git</a>
    <span class=-mono>${hee(modName)}</span>
  </div>
  <div class="-body -detail-body">
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
  node: { css: ["pub/main.css"], js: ["pub/main.js"], render },
};
