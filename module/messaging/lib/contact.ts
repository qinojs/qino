import { sql } from "@qino/qino";

import type { App, Row } from "@qino/qino";

/** Resolve selected users to preferred contacts and literal addresses to owners, keeping unknown literals anonymous. */
export async function contactRecipients(
  app: App,
  type: string,
  to: { grp?: number; usr?: number; all?: true },
  direct: (Row & { address: string; usrId?: number })[] = [],
): Promise<(Row & { address: string; usrId?: number })[]> {
  const who = to.grp != null ? sql`c.usr_id IN (SELECT usr_id FROM usr_grp WHERE grp_id = ${to.grp})`
    : to.usr != null ? sql`c.usr_id = ${to.usr}`
    : to.all ? sql`${true}`
    : null;
  if (!who && !direct.length) throw new Error("contact recipients need a selection or direct address");
  const preferred = who
    ? sql`(${who}) AND c.address = (
      SELECT other.address FROM usr_contact other
      WHERE other.type = ${type} AND other.usr_id = c.usr_id
      ORDER BY other.main DESC, other.created, other.address LIMIT 1)`
    : null;
  const literal = direct.length
    ? sql`c.address IN (${sql.join(direct.map(({ address }) => sql`${address}`), ", ")})`
    : null;
  const found = new Map(direct.map((recipient) => [recipient.address, recipient]));
  const rows = await app.db.query`
    SELECT c.*, u.firstname, u.lastname, u.company, u.email FROM usr_contact c
    LEFT JOIN usr u ON u.id = c.usr_id
    WHERE c.type = ${type} AND (${sql.join([preferred, literal].flatMap((v) => v ?? []), " OR ")})`;
  for (const row of rows) {
    const address = String(row.address);
    found.set(address, { ...row, address, usrId: Number(row.usr_id) || undefined });
  }
  return [...found.values()];
}
