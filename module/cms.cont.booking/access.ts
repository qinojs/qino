import { AccessError, sql } from "@qino/qino";

import type { Node } from "@qino/qino/cms";

export async function readable(node: Node) {
  if (node.vs.module !== "cms.cont.booking" || !await node.isReadable()) throw new AccessError();
}

/** One transactional row per instance; legacy CMS page tables need not support transactions. */
export async function lock(node: Node) {
  const conflict = node.db.dialect === "mysql" ? sql`ON DUPLICATE KEY UPDATE node_id = ${node.id}`
    : sql`ON CONFLICT (node_id) DO UPDATE SET node_id = ${node.id}`;
  await node.db.exec`INSERT INTO cms_booking_calendar (node_id) VALUES (${node.id}) ${conflict}`;
}
