import type { Node } from "../cms/mod.ts";
/** Node access is the permission — whoever may read this backend node may revoke tickets. */
export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  const app = node.app;
  // by hash: revoking needs no capability, and the handle itself is nowhere to be had
  if (vars.revoke) {
    await app.db.exec`DELETE FROM ticket WHERE hash = ${String(vars.revoke)}`;
    return { ok: true, message: await app.t`Ticket revoked.` };
  }
  return null;
}
