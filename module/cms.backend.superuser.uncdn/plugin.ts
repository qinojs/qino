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

/** The cache as a u2-tree, and the bytes below `path`. */
async function buildTree(path: string, baseLen: number): Promise<[HtmlString, number]> {
  const entries: Deno.DirEntry[] = await Array.fromAsync(Deno.readDir(path)).catch(() => []);
  entries.sort((a, b) =>
    a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1
  );
  let total = 0;
  const parts = await Promise.all(entries.map(async (e) => {
    const full = path + e.name;
    const [children, size]: [HtmlString, number] = e.isDirectory
      ? await buildTree(full + "/", baseLen)
      : [html``, (await Deno.stat(full).catch(() => null))?.size ?? 0];
    total += size;
    return html`<u2-tree>
      <u2-ico slot=icon icon=${e.isDirectory ? "folder" : "description"}>${e.isDirectory ? "🗀" : "🗎"}</u2-ico>
      ${e.isDirectory ? e.name : html`<code>${e.name}</code>`}
      <small style="margin-left:auto"><u2-bytes>${size}</u2-bytes></small>
      <button data-delete="${full.slice(baseLen)}" class=u2-unstyle u2-confirm><u2-ico icon=delete>✕</u2-ico></button>
      ${children}
    </u2-tree>`;
  }));
  return [html.join(parts), total];
}

async function render(node: Node, { vars = {} }: { vars?: Record<string, unknown> } = {}): Promise<HtmlString> {
  const { app } = node;
  const t = app.t;
  const cacheDir = app.modules.get("uncdn")!.cache;
  const root = nodePath.resolve(cacheDir);

  // An empty path is the whole cache; anything else has to stay inside it. Nothing recreates
  // the directory — uncdn mkdir's its way back on the next miss.
  if (vars.delete !== undefined) {
    const target = nodePath.resolve(root, String(vars.delete).replace(/^\/+/, ""));
    if (target === root || target.startsWith(root + nodePath.sep))
      await Deno.remove(target, { recursive: true }).catch(() => {}); // already gone
  }

  const [tree, totalSize] = await buildTree(cacheDir, cacheDir.length);
  const maxCacheBytes = cacheByteLimit(await app.settings.uncdn.maxCacheBytes);
  const origins = [...uncdn(app).origins].sort();

  return html.async`<div class=u2-flex>
  <div class="u2-card -sidebar" style="flex:0 0 auto">
    <div class=-head>${t`Info`}</div>
    <div>
      <table class=u2-table>
        <tr>
          <td>${t`Cache size`}
          <td><u2-bytes>${totalSize}</u2-bytes>
        <tr>
          <td>${t`Max cache bytes`}
          <td><u2-bytes>${maxCacheBytes}</u2-bytes>
        <tr>
          <td>${t`Cache path`}
          <td><small><code>${cacheDir}</code></small>
      </table>
    </div>
    <div class=-head>${t`Allow-list (CSP)`}</div>
    <div>
      ${origins.length ? html`<table class=u2-table>${origins.map(o => html`<tr><td><small><code>${o}</code></small>`)}</table>` : html.async`<em>${t`No origins declared yet.`}</em>`}
    </div>
    <div class=-head>${t`Actions`}</div>
    <div>
      <button data-delete="" u2-confirm><u2-ico icon=delete>✕</u2-ico> ${t`Delete all`}</button>
    </div>
  </div>
  <div class=u2-card style="flex:1">
    <div class=-head>${t`Cached files`}</div>
    <div>
      ${tree.html ? html`<u2-tree aria-expanded=true><u2-ico slot=icon icon=folder>🗀</u2-ico>root ${tree}</u2-tree>` : html.async`<em>${t`No cached files yet.`}</em>`}
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
