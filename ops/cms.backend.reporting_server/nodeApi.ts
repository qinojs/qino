import type { Node } from "@qino/qino/cms";

/** `deleteError`: an error group is done, on every instance. `deleteInstance`: forget it, its errors with it. */
export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  const db = node.app.db;
  if (typeof vars.deleteError === "string") await db.exec`DELETE FROM reporting_error WHERE fp = ${vars.deleteError}`;
  else if (typeof vars.deleteInstance === "string") await db.table("reporting_instance").delete(vars.deleteInstance);
  else return false;
  return { ok: true };
}
