import type { App } from "../../module/core/mod.ts";
import { currentModule } from "./renamedModules.ts";

/** PHP put a class on every content element: `-m-` plus the module name with dots turned into
 *  dashes. qino injects `qcms-mod` with the name minus its `cms.` prefix:
 *
 *      .-m-cms-cont-section3   →   [qcms-mod="cont.section3"]
 *
 *  Dashes cannot simply be turned back into dots — a module name may hold one itself
 *  (`cms.backend.domain-monitor`), so the names come from the database. Specificity is unchanged:
 *  an attribute selector weighs the same as a class. */
export async function migrateCss(app: App): Promise<void> {
  const modules = await app.db.col<string>`SELECT DISTINCT module FROM page WHERE module <> ''`;
  // longest first, so cms.cont.form1.fields2 wins over cms.cont.form1
  // the selector must name the module the node ends up with, not the one it came from
  const pairs = modules
    .map((m) => [".-m-" + m.replaceAll(".", "-"), `[qcms-mod="${currentModule(m).replace(/^cms\./, "")}"]`] as const)
    .sort((a, b) => b[0].length - a[0].length);

  let files = 0, hits = 0;
  for await (const path of cssFiles(app.appPATH + "data/")) {
    const before = await Deno.readTextFile(path);
    let after = before;
    for (const [legacy, current] of pairs) {
      // not followed by a name character — ".-m-cms-cont-form1" must not eat "…-fields2"
      after = after.replaceAll(new RegExp(escapeRe(legacy) + "(?![\\w-])", "g"), current);
    }
    if (after === before) continue;
    hits += before.split(".-m-").length - 1;
    await Deno.writeTextFile(path, after);
    files++;
  }
  if (files) console.log(`[migrate_from_php] css: ${hits} legacy selectors in ${files} files → [qcms-mod]`);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function* cssFiles(dir: string): AsyncGenerator<string> {
  const entries = await Array.fromAsync(Deno.readDir(dir)).catch(() => []);
  for (const entry of entries) {
    const path = dir + entry.name;
    if (entry.isDirectory) yield* cssFiles(path + "/");
    else if (entry.name.endsWith(".css")) yield path;
  }
}
