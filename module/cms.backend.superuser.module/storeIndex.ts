import { fromFileUrl } from "@std/path";
import { isModuleName, type Store } from "../core/mod.ts";

/** Every file of a module, relative to its folder; `tests/` stays behind, a consumer runs the module. */
async function moduleFiles(dir: string, base = dir): Promise<string[]> {
  const found: string[] = [];
  for await (const e of Deno.readDir(dir)) {
    if (e.isDirectory) {
      if (dir === base && e.name === "tests") continue;
      found.push(...await moduleFiles(`${dir}${e.name}/`, base));
    } else if (e.isFile) found.push((dir + e.name).slice(base.length));
  }
  return found.sort();
}

/** Module folders physically present in a local store; its possibly stale catalog is not consulted. */
async function moduleNames(dir: string): Promise<string[]> {
  const names: string[] = [];
  for await (const e of Deno.readDir(dir)) {
    if (!e.isDirectory || !isModuleName(e.name)) continue;
    const plugin = await Deno.stat(`${dir}${e.name}/plugin.ts`).then((s) => s.isFile, (error) => {
      if (error instanceof Deno.errors.NotFound) return false;
      throw error;
    });
    if (plugin) names.push(e.name);
  }
  return names.sort();
}

/** Refresh `files` in every manifest and the catalog beside them. Reports what changed, so a click
 *  that was not needed says so instead of looking like work. */
export async function writeIndex(store: Store): Promise<string> {
  if (!store.base.startsWith("file:")) throw new Error("Only a local store can be written");
  const dir = fromFileUrl(store.base);
  const names = await moduleNames(dir);
  const changed: string[] = [];
  for (const mod of names) {
    const modDir = `${dir}${mod}/`;
    const file = modDir + "manifest.json";
    const manifest = await Deno.readTextFile(file).then(JSON.parse, (error) => {
      if (error instanceof Deno.errors.NotFound) return { name: mod };
      throw error;
    });
    const files = await moduleFiles(modDir);
    if (JSON.stringify(manifest.files) === JSON.stringify(files)) continue;
    manifest.files = files; // in place: any other field keeps its position
    await Deno.writeTextFile(file, JSON.stringify(manifest, null, 2) + "\n");
    changed.push(mod);
  }
  // The catalog is what a remote store cannot do without; per-module metadata in it survives.
  const catalog = dir + "store.json";
  const before = await Deno.readTextFile(catalog).catch((error) => {
    if (error instanceof Deno.errors.NotFound) return "";
    throw error;
  });
  const known = before ? JSON.parse(before).modules ?? {} : {};
  const next = JSON.stringify({ modules: Object.fromEntries(names.map((mod) => [mod, known[mod] ?? {}])) }, null, 2) + "\n";
  const wroteCatalog = next !== before;
  if (wroteCatalog) await Deno.writeTextFile(catalog, next);

  if (!changed.length && !wroteCatalog) return "Nothing to write — everything is up to date.";
  return [
    changed.length ? `${changed.length} manifest(s) updated: ${changed.join(", ")}` : "",
    wroteCatalog ? `store.json written (${names.length} modules)` : "",
  ].filter(Boolean).join(" · ");
}
