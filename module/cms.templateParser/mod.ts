// Public API of cms.templateParser. The qino plugin lives in ./plugin.ts.

import type { Node } from "../cms/mod.ts";
import { parseTemplate, type TNode } from "./parse.ts";
import { renderNodes } from "./render.ts";

// parsed templates keyed by file path — derived from the file only, safe to share across apps
const cache = new Map<string, { mtime: number; ast: TNode[] }>();

/** Parsed template of a file, reparsed whenever the file changes; undefined if there is no such file. */
export async function loadTemplate(path: string): Promise<TNode[] | undefined> {
  const stat = await Deno.stat(path).catch(() => null);
  if (!stat?.isFile) return;
  const mtime = stat.mtime?.getTime() ?? 0;
  const cached = cache.get(path);
  if (cached?.mtime === mtime) return cached.ast;
  const source = await Deno.readTextFile(path).catch(() => undefined);
  if (source === undefined) return;
  const ast = parseTemplate(source);
  cache.set(path, { mtime, ast });
  return ast;
}

/** Render a template file for a node; undefined if there is no such file. */
export async function renderTemplateFile(path: string, node: Node): Promise<string | undefined> {
  const ast = await loadTemplate(path);
  return ast && renderNodes(ast, node);
}
