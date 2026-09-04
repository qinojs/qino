// deno-lint-ignore-file no-explicit-any
import * as nodePath from "node:path";
import { html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { cacheByteLimit, uncdn } from "@qino/qino/uncdn";

import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export async function install({ app }: { app: App }) {
  await backend.install(app, name, { en: "UnCDN Cache", de: "UnCDN Cache" });
}

type TreeResult = { html: HtmlString; size: number };

async function buildTree(path: string, baseLen: number): Promise<TreeResult> {
  const parts = [];
  let size = 0;
  try {
    const entries = [];
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
          html: html`<u2-tree>
            <u2-ico slot=icon icon=folder>🗀</u2-ico>
            ${e.name}
            <small style="margin-left:auto"><u2-bytes>${sub.size}</u2-bytes></small>
            <button data-delete=${JSON.stringify(rel + "/")} class=u2-unstyle u2-confirm><u2-ico icon=delete>✕</u2-ico></button>
            ${sub.html}
          </u2-tree>`,
        };
      } else {
        const fileSize = (await Deno.stat(full).catch(() => null))?.size ?? 0;
        return {
          size: fileSize,
          html: html`<u2-tree>
            <u2-ico slot=icon icon=description>🗎</u2-ico>
            <code>${e.name}</code>
            <small style="margin-left:auto"><u2-bytes>${fileSize}</u2-bytes></small>
            <button data-delete=${JSON.stringify(rel)} class=u2-unstyle u2-confirm><u2-ico icon=delete>✕</u2-ico></button>
          </u2-tree>`,
        };
      }
    }));
    for (const r of results) { parts.push(r.html); size += r.size; }
  } catch { /* empty or missing dir */ }
  return { html: html.join(parts), size };
}

async function render(node: Node, { vars = {} }: { vars?: Record<string, any> } = {}): Promise<HtmlString> {
  const cacheDir = node.app.modules.get("uncdn")!.cache;

  if (vars.delete) {
    const target = nodePath.resolve(cacheDir, String(vars.delete).replace(/^\/+/, ""));
    if (target.startsWith(nodePath.resolve(cacheDir) + nodePath.sep)) {
      try { await Deno.remove(target, { recursive: true }); } catch { /* already gone */ }
    }
  }

  if (vars.deleteAll) {
    try { await Deno.remove(cacheDir, { recursive: true }); } catch { /* already gone */ }
    try { await Deno.mkdir(cacheDir, { recursive: true }); } catch { /* ignore */ }
  }

  const { html: tree, size: totalSize } = await buildTree(cacheDir, cacheDir.length);
  const maxCacheBytes = cacheByteLimit(await node.app.settings.uncdn.maxCacheBytes);

  const origins = [...uncdn(node.app).origins].sort();

  const t = node.app.t;
  const [tCacheSize, tMaxCacheBytes, tCachePath, tActions, tDeleteAll, tInfo, tCachedFiles, tNoCached, tAllowList, tNoOrigins] = await Promise.all([
    t`Cache size`,
    t`Max cache bytes`,
    t`Cache path`,
    t`Actions`,
    t`Delete all`,
    t`Info`,
    t`Cached files`,
    t`No cached files yet.`,
    t`Allow-list (CSP)`,
    t`No origins declared yet.`,
  ]);

  return html`<div class=u2-flex>
  <div class="u2-card -sidebar" style="flex:0 0 auto">
    <div class=-head>${tInfo}</div>
    <div>
      <table class=u2-table>
        <tr><td>${tCacheSize}<td><u2-bytes>${totalSize}</u2-bytes>
        <tr><td>${tMaxCacheBytes}<td><u2-bytes>${maxCacheBytes}</u2-bytes>
        <tr><td>${tCachePath}<td><small><code>${cacheDir}</code></small>
      </table>
    </div>
    <div class=-head>${tAllowList}</div>
    <div>
      ${origins.length ? html`<table class=u2-table>${origins.map(o => html`<tr><td><small><code>${o}</code></small>`)}</table>` : html`<em>${tNoOrigins}</em>`}
    </div>
    <div class=-head>${tActions}</div>
    <div>
      <button data-reload='{"deleteAll":1}' u2-confirm><u2-ico icon=delete>✕</u2-ico> ${tDeleteAll}</button>
    </div>
  </div>
  <div class=u2-card style="flex:1">
    <div class=-head>${tCachedFiles}</div>
    <div>
      ${tree.html ? html`<u2-tree aria-expanded=true><u2-ico slot=icon icon=folder>🗀</u2-ico>root ${tree}</u2-tree>` : html`<em>${tNoCached}</em>`}
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
