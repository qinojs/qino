// Public API of cms.templateParser. The qino plugin lives in ./plugin.ts.

import type { Node } from "@qino/qino/cms";
import { parseTemplate, type TNode } from "./parse.ts";
import { renderNodes } from "./render.ts";

// Parsed templates keyed by path/URL — derived from the source only, safe to share across apps.
const cache = new Map<string, { mtime?: number; ast: TNode[] }>();

/** Parsed local or remote template; local files are reparsed whenever they change. */
export async function loadTemplate(source: string | URL): Promise<TNode[] | undefined> {
  const key = String(source);
  const input = key.startsWith("file:") ? new URL(key) : source;
  if (/^https?:\/\//.test(key)) {
    const cached = cache.get(key);
    if (cached) return cached.ast;
    const res = await fetch(input).catch(() => null);
    if (!res?.ok) return;
    const ast = parseTemplate(await res.text());
    cache.set(key, { ast });
    return ast;
  }
  const stat = await Deno.stat(input).catch(() => null);
  if (!stat?.isFile) return;
  const mtime = stat.mtime?.getTime() ?? 0;
  const cached = cache.get(key);
  if (cached?.mtime === mtime) return cached.ast;
  const html = await Deno.readTextFile(input).catch(() => undefined);
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
export { layoutOptions, moduleTemplate } from "./moduleTemplate.ts";
