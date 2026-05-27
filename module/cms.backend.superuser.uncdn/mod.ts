// deno-lint-ignore-file no-explicit-any
import { hee } from "../core/lib/util.ts";
import { getCtx } from "../core/lib/RequestContext.ts";
import { backend } from "../cms.backend/mod.ts";
import { CACHE_SUBDIR, cacheByteLimit, fetchPolicy } from "../uncdn/mod.ts";
import type { Node } from "../cms/lib/Node.ts";
import type { App } from "../core/server.ts";

export const name = "cms.backend.superuser.uncdn";
export const needs = ["cms.backend", "uncdn"];

export async function install({ app }: { app: App }) {
  const P = await backend.install(app, name);
  if (P) {
    await P.title("en", "UnCDN Cache");
    await P.title("de", "UnCDN Cache");
  }
}

type TreeResult = { html: string; size: number };

async function buildTree(path: string, baseLen: number): Promise<TreeResult> {
  let html = "";
  let size = 0;
  try {
    const entries: Deno.DirEntry[] = [];
    for await (const e of Deno.readDir(path)) entries.push(e);
    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    const results = await Promise.all(entries.map(async (e) => {
      const full = path + e.name;
      const rel = full.slice(baseLen);
      if (e.isDirectory) {
        const sub = await buildTree(full + "/", baseLen);
        return {
          size: sub.size,
          html: `<u2-tree>
            <u2-ico slot=icon>folder</u2-ico>
            ${hee(e.name)}
            <small style="margin-left:auto"><u2-bytes>${sub.size}</u2-bytes></small>
            <button data-delete=${JSON.stringify(rel + "/")} class="u2-unstyle" u2-confirm><u2-ico>delete</u2-ico></button>
            ${sub.html}
          </u2-tree>`,
        };
      } else {
        const fileSize = (await Deno.stat(full).catch(() => null))?.size ?? 0;
        return {
          size: fileSize,
          html: `<u2-tree>
            <u2-ico slot=icon>description</u2-ico>
            <code>${hee(e.name)}</code>
            <small style="margin-left:auto"><u2-bytes>${fileSize}</u2-bytes></small>
            <button data-delete=${JSON.stringify(rel)} class="u2-unstyle" u2-confirm><u2-ico>delete</u2-ico></button>
          </u2-tree>`,
        };
      }
    }));
    for (const r of results) { html += r.html; size += r.size; }
  } catch { /* empty or missing dir */ }
  return { html, size };
}

async function render(node: Node, { vars = {} }: { vars?: Record<string, any> } = {}): Promise<string> {
  const ctx = getCtx();
  if (!await ctx.user?.get?.("superuser")) return "<div></div>";

  const cacheDir = node.app.appPATH + CACHE_SUBDIR;

  if (vars.delete) {
    const target = cacheDir + String(vars.delete).replace(/^\/+/, "");
    try { await Deno.remove(target, { recursive: true }); } catch { /* already gone */ }
  }

  if (vars.deleteAll) {
    try { await Deno.remove(cacheDir, { recursive: true }); } catch { /* already gone */ }
    try { await Deno.mkdir(cacheDir, { recursive: true }); } catch { /* ignore */ }
  }

  const { html: tree, size: totalSize } = await buildTree(cacheDir, cacheDir.length);
  const policy = fetchPolicy(await node.app.settings.uncdn.fetchPolicy);
  const maxCacheBytes = cacheByteLimit(await node.app.settings.uncdn.maxCacheBytes);

  const [tCacheSize, tMaxCacheBytes, tFetchPolicy, tCachePath, tActions, tDeleteAll, tInfo, tCachedFiles, tNoCached] = await Promise.all([
    node.app.t`Cache size`,
    node.app.t`Max cache bytes`,
    node.app.t`Fetch policy`,
    node.app.t`Cache path`,
    node.app.t`Actions`,
    node.app.t`Delete all`,
    node.app.t`Info`,
    node.app.t`Cached files`,
    node.app.t`No cached files yet.`,
  ]);

  return `<div class="u2-flex -m-cms-backend-superuser-uncdn" data-pid="${node.id}" data-sys-url="${ctx.sysURL}">
  <div class="u2-card -sidebar" style="flex:0 0 auto">
    <div class="-head">${tInfo}</div>
    <div class="-body">
      <table class=u2-table>
        <tr><td>${tCacheSize}<td><u2-bytes>${totalSize}</u2-bytes>
        <tr><td>${tMaxCacheBytes}<td><u2-bytes>${maxCacheBytes}</u2-bytes>
        <tr><td>${tFetchPolicy}<td><code>${hee(policy)}</code>
        <tr><td>${tCachePath}<td><small><code>${hee(cacheDir)}</code></small>
      </table>
    </div>
    <div class="-head">${tActions}</div>
    <div class="-body">
      <button data-reload='{"deleteAll":1}' u2-confirm><u2-ico>delete</u2-ico> ${tDeleteAll}</button>
    </div>
  </div>
  <div class="u2-card" style="flex:1">
    <div class="-head">${tCachedFiles}</div>
    <div class="-body">
      ${tree ? `<u2-tree aria-expanded="true"><u2-ico slot=icon>folder</u2-ico>root ${tree}</u2-tree>` : `<em>${tNoCached}</em>`}
    </div>
  </div>
</div>`;
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render,
  },
};
