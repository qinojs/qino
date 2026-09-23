import { fs } from "@qino/qino";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

/** Some PHP modules included the site's markup from `qg/<module>/index.php`. In qino that is
 *  `data/<module>/index.ts` with a default export like a module render. Undefined if missing. */
export async function siteTemplate(
  node: Node,
  data: unknown,
): Promise<HtmlString | string | undefined> {
  const path = node.module!.data + "index.ts";
  if (!await fs.isFile(path)) return; // no site template for this module
  try {
    const mod = await import(path);
    if (typeof mod.default === "function") return await mod.default(node, data);
  } catch { /* broken site template */ }
}
