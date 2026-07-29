import type { Node } from "../cms/mod.ts";
import { prune } from "../score/mod.ts";

export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  if (!vars.prune) return false;
  const db = node.app.db;
  const before = Number(await db.one`SELECT COUNT(*) FROM score`);
  await prune(db);
  const gone = before - Number(await db.one`SELECT COUNT(*) FROM score`);
  return { ok: true, message: `${gone} ${await node.app.t`faded scores deleted`}` };
}
