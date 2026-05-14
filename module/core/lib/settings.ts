import { hee } from "./util.ts";
import type { RequestContext } from "./RequestContext.ts";

export type SettingsSource = {
  kind: "app" | "ctx" | "node" | "page";
  path?: string[];
  id?: number;
};

function normalizeSettingsSource(source: SettingsSource): SettingsSource {
  if (!source || typeof source !== "object") {
    throw new Error("Invalid settings source");
  }
  const path = (source.path ?? []).filter((k) => typeof k === "string" && k);
  if (source.kind === "node" || source.kind === "page") {
    const id = Number(source.id ?? "");
    if (!id) throw new Error("Missing node settings source id");
    return { kind: "node", id, path };
  }
  if (source.kind === "app" || source.kind === "ctx") {
    return { kind: source.kind, path };
  }
  throw new Error(`Unknown settings source "${String(source.kind)}"`);
}

export function settingsSourceAttr(source: SettingsSource): string {
  return hee(JSON.stringify(normalizeSettingsSource(source)));
}

export function allowSettingsEditorAssets(ctx: RequestContext): void {
  ctx.csp["script-src"] ??= {};
  ctx.csp["script-src"]["https://cdn.jsdelivr.net"] = 1;
}

export function addSettingsEditor(ctx: RequestContext): void {
  allowSettingsEditorAssets(ctx);
  ctx.html.addJSM(ctx.sysURL + "core/pub/js/SettingsEditor.mjs");
}

export async function readSettings(item: any): Promise<unknown> {
  await item.read();
  if (item.keys?.length) {
    const data: Record<string, unknown> = {};
    for (const key of item.keys) data[key] = await readSettings(item.item(key));
    return data;
  }
  return item.get() ?? null;
}
