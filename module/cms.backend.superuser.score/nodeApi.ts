import { prune } from "@qino/qino/score";

import { total } from "./render.ts";

import type { Node } from "@qino/qino/cms";

export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  if (!vars.prune) return false;
  const db = node.app.db;
  const before = await total(db);
  await prune(db);
  const gone = before - await total(db);
  return { ok: true, message: `${gone} ${await node.app.t`faded scores deleted`}` };
}
