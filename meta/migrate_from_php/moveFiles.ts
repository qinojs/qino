import type { App } from "../../module/core/mod.ts";

/** The PHP CMS kept app files under qg/, uploads in qg/file/. They now live in
 *  data/<module>/, uploads owned by core. Names stay, so rows referencing a file keep working. */
export async function migrateFiles(app: App): Promise<void> {
  const legacy = app.appPATH + "qg/";
  let moved = 0, kept = 0;
  for (const name of await dirNames(legacy)) {
    // "file" is not a module — the uploads are core's
    const [m, k] = await moveMerge(legacy + name + "/", app.appPATH + (name === "file" ? "data/core/file/" : `data/${name}/`));
    moved += m;
    kept += k;
  }
  await Deno.remove(legacy).catch(() => {}); // only when nothing was left behind
  if (moved || kept) console.log(`[migrate_from_php] qg/ → data/: ${moved} moved` + (kept ? `, ${kept} kept (target existed)` : ""));
}

/** Directory names directly below dir; empty when it does not exist. */
export async function dirNames(dir: string): Promise<string[]> {
  const entries = await Array.fromAsync(Deno.readDir(dir)).catch(() => []);
  return entries.filter((e) => e.isDirectory).map((e) => e.name).sort();
}

/** Move every entry of src into dst, recursing where both sides hold a directory.
 *  An existing target is never overwritten; it is counted and src keeps its copy.
 *  Running it again once src is gone does nothing, so a repeated repair is harmless. */
export async function moveMerge(src: string, dst: string): Promise<[moved: number, kept: number]> {
  let moved = 0, kept = 0;
  const entries = await Array.fromAsync(Deno.readDir(src)).catch(() => []);
  if (!entries.length) return [0, 0];
  await Deno.mkdir(dst, { recursive: true });
  for (const entry of entries) {
    const from = src + entry.name, to = dst + entry.name;
    const target = await Deno.stat(to).catch(() => null);
    if (!target) {
      await Deno.rename(from, to);
      moved++;
    } else if (entry.isDirectory && target.isDirectory) {
      const [m, k] = await moveMerge(from + "/", to + "/");
      moved += m;
      kept += k;
    } else kept++;
  }
  await Deno.remove(src).catch(() => {}); // succeeds only when everything moved
  return [moved, kept];
}
