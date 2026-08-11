import type { App } from "../../module/core/mod.ts";
import { currentModule } from "./renamedModules.ts";

/** PHP put classes for the module and node id on every content element. qino uses attributes:
 *
 *      .-m-cms-cont-section3   →   [qcms-mod="cont.section3"]
 *      .-pid123                 →   [qcms-id="123"]
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
    after = after.replaceAll(/\.-pid(\d+)(?![\w-])/g, '[qcms-id="$1"]');
    after = after.replaceAll(/\/qg\/([A-Za-z0-9._-]+)\//g, (_match, module) =>
      relativeDir(path, `${app.appPATH}data/${module}/`)
    );
    if (after === before) continue;
    hits += before.match(/\.-m-|\.-pid\d+(?![\w-])|\/qg\/[A-Za-z0-9._-]+\//g)?.length ?? 0;
    await Deno.writeTextFile(path, after);
    files++;
  }
  if (files) console.log(`[migrate_from_php] css: ${hits} legacy selectors in ${files} files → qcms attributes`);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function relativeDir(from: string, to: string): string {
  const fromParts = from.split("/");
  const toParts = to.split("/");
  fromParts.pop();
  if (!toParts.at(-1)) toParts.pop();
  let common = 0;
  while (fromParts[common] === toParts[common] && common < fromParts.length) common++;
  const path = "../".repeat(fromParts.length - common) + toParts.slice(common).join("/");
  return path ? path + "/" : "";
}

async function* cssFiles(dir: string): AsyncGenerator<string> {
  const entries = await Array.fromAsync(Deno.readDir(dir)).catch(() => []);
  for (const entry of entries) {
    const path = dir + entry.name;
    if (entry.isDirectory) yield* cssFiles(path + "/");
    else if (entry.name.endsWith(".css")) yield path;
  }
}
