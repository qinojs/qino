// Public API of cms.templateParser. The qino plugin lives in ./plugin.ts.
import { fileURLToPath } from "node:url";
import { fs } from "@qino/qino";

import { parseTemplate } from "./parse.ts";
import { renderNodes } from "./render.ts";

import type { Node } from "@qino/qino/cms";
import type { TNode } from "./parse.ts";

// Parsed templates keyed by path/URL — derived from the source only, safe to share across apps.
const cache = new Map<string, { mtime?: number; ast: TNode[] }>();

/** Parsed local or remote template; local files are reparsed when they change. */
export async function loadTemplate(source: string | URL): Promise<TNode[] | undefined> {
  const key = String(source);
  if (/^https?:\/\//.test(key)) {
    const cached = cache.get(key);
    if (cached) return cached.ast;
    const res = await fetch(key).catch(() => null);
    if (!res?.ok) return;
    const ast = parseTemplate(await res.text());
    cache.set(key, { ast });
    return ast;
  }
  const path = key.startsWith("file:") ? fileURLToPath(key) : key;
  const info = await fs.stat(path);
  if (!info?.isFile) return;
  const mtime = info.mtime?.getTime() ?? 0;
  const cached = cache.get(key);
  if (cached?.mtime === mtime) return cached.ast;
  const html = await fs.text(path).catch(() => undefined);
  if (html === undefined) return;
  const ast = parseTemplate(html);
  cache.set(key, { mtime, ast });
  return ast;
}

/** Render a template file for a node; undefined if there is no such file. */
export async function renderTemplateFile(source: string | URL, node: Node): Promise<string | undefined> {
  const ast = await loadTemplate(source);
  return ast && renderNodes(ast, node);
}

// Layout-style modules ship a template the site takes over — kept separate, see moduleTemplate.ts.
export { moduleTemplate } from "./moduleTemplate.ts";
