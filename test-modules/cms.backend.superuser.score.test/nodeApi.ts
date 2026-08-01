import type { Node } from "@qino/qino/cms";
import { scopes } from "@qino/qino/score";
import { TABLES } from "./hooks.ts";

export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  if (!vars.clear) return false;
  let gone = 0;
  for (const tbl of Object.keys(TABLES)) {
    const scope = scopes(node.app.db).get(tbl);
    if (scope) gone += (await node.app.db.exec`DELETE FROM score WHERE scope_id = ${scope.id}`).affectedRows;
  }
  return { ok: true, message: `${gone} ${await node.app.t`scores deleted`}` };
}
