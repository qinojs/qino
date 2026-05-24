import type { App } from "../core/server.ts";
import { parseTemplate } from "./parse.ts";
import { buildRenderFn, buildPartFn, extractParts } from "./render.ts";

export const name = "cms.templateParser";
export const needs = ["cms"];

type ParsedModule = {
  render: (node: unknown, opts?: unknown) => Promise<string>;
  parts:  Record<string, (node: unknown, opts?: unknown) => Promise<string>>;
};

const cache = new Map<string, ParsedModule>();

async function loadTemplate(dir: string): Promise<ParsedModule | null> {
  let source: string;
  try { source = await Deno.readTextFile(dir + "template.html"); }
  catch { return null; }
  const ast   = parseTemplate(source);
  const parts = extractParts(ast);
  return {
    render: buildRenderFn(ast) as ParsedModule["render"],
    parts:  Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, buildPartFn(v) as ParsedModule["parts"][string]])),
  };
}

function watchTemplate(modName: string, templatePath: string, exports_: Record<string, unknown>): void {
  (async () => {
    for await (const event of Deno.watchFs(templatePath)) {
      if (event.kind === "modify" || event.kind === "create") {
        cache.delete(modName);
        delete ((exports_.cms as Record<string, unknown>)?.node as Record<string, unknown>)?.parts;
      }
    }
  })();
}

function injectParts(exports_: Record<string, unknown>, parsed: ParsedModule): void {
  if (!Object.keys(parsed.parts).length) return;
  const cmsExports  = (exports_.cms  ??= {}) as Record<string, unknown>;
  const nodeExports = (cmsExports.node ??= {}) as Record<string, unknown>;
  if (nodeExports.parts) return;
  nodeExports.parts = parsed.parts;
}

export function init(app: App) {
  app.on("cms.node.render", async (e) => {
    const node     = e.node as { module?: { name?: string; dir?: string; exports?: Record<string, unknown> } };
    const dir      = node.module?.dir;
    if (!dir) return;

    const modName  = node.module?.name ?? "";
    const exports_ = node.module?.exports ?? {};

    if (!cache.has(modName)) {
      const parsed = await loadTemplate(dir);
      if (!parsed) return;
      cache.set(modName, parsed);
      watchTemplate(modName, dir + "template.html", exports_);
    }

    const parsed = cache.get(modName)!;
    (e as Record<string, unknown>).render = parsed.render;
    injectParts(exports_, parsed);
  });
}
