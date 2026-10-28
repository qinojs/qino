import { cms } from "@qino/qino/cms";

import type { Node } from "@qino/qino/cms";

/** The form to show entries of: the configured one, else the first on the page. */
export async function formOf(node: Node) {
  const id = Number(node.settings.form());
  if (id) {
    const form = await cms(node.app).node(id);
    return form.exists() && form.vs.module === "cms.cont.form" ? form : undefined;
  }
  const page = [...(await node.path()).values()].findLast((n) => n.vs.type === "p");
  if (!page) return;
  for (const cont of (await page.bough()).values()) if (cont.vs.module === "cms.cont.form") return cont;
}

/** Whether `form` allows `node` to show its entries (its setting `listing_nodes`): who may edit the
 *  form decides, so an editor of the block cannot pick just any form. */
export function listedBy(form: Node, node: Node) {
  try { return JSON.parse(String(form.vs.settings || "{}")).listing_nodes?.[node.id] === true; } catch { return false; }
}
