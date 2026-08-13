import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

/** Several PHP modules were only a shell and included the site's own markup from
 *  `qg/<module>/index.php`. In qino that file is `data/<module>/index.ts`, exporting a default
 *  function with the same signature as a module render. Undefined when the site has none. */
export async function siteTemplate(
  node: Node,
  data: unknown,
): Promise<HtmlString | string | undefined> {
  const path = node.module!.data + "index.ts";
  try {
    await Deno.stat(path);
    const mod = await import(path);
    if (typeof mod.default === "function") return await mod.default(node, data);
  } catch { /* no site template for this module */ }
}
