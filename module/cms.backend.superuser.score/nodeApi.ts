import type { Node } from "@qino/qino/cms";
import { prune } from "@qino/qino/score";

export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  if (!vars.prune) return false;
  const db = node.app.db;
  const before = Number(await db.one`SELECT COUNT(*) FROM score`);
  await prune(db);
  const gone = before - Number(await db.one`SELECT COUNT(*) FROM score`);
  return { ok: true, message: `${gone} ${await node.app.t`faded scores deleted`}` };
}
