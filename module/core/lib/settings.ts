import { hee } from "./util.ts";

export type SettingsSource = {
  kind: "app" | "ctx" | "node" | "page";
  path?: string[];
  id?: number;
};

function normalizePath(path?: string[]): string[] {
  return Array.isArray(path)
    ? path.filter((key) => typeof key === "string" && key)
    : [];
}

function normalizeSettingsSource(source: SettingsSource): SettingsSource {
  if (!source || typeof source !== "object") {
    throw new Error("Invalid settings source");
  }
  if (source.kind === "node" || source.kind === "page") {
    const id = parseInt(String(source.id ?? ""));
    if (!id) throw new Error("Missing node settings source id");
    return { kind: "node", id, path: normalizePath(source.path) };
  }
  if (source.kind === "app" || source.kind === "ctx") {
    return { kind: source.kind, path: normalizePath(source.path) };
  }
  throw new Error(`Unknown settings source "${String((source as any).kind)}"`);
}

export function settingsSourceAttr(source: SettingsSource): string {
  return hee(JSON.stringify(normalizeSettingsSource(source)));
}

export function allowSettingsEditorAssets(ctx: any): void {
  ctx.csp["script-src"] ??= {};
  ctx.csp["script-src"]["https://cdn.jsdelivr.net"] = 1;
}

export function addSettingsEditor(ctx: any): void {
  allowSettingsEditorAssets(ctx);
  ctx.html.addJSM(ctx.sysURL + "core/js/SettingsEditor.mjs");
}

export async function readSettings(item: any): Promise<any> {
  await item.read();
  if (item.keys?.length) {
    const data: Record<string, any> = {};
    for (const key of item.keys) data[key] = await readSettings(item.item(key));
    return data;
  }
  return item.get() ?? null;
}
