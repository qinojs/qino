import { sql } from "@qino/qino";

import { selectors } from "../mod.ts";

import type { App } from "@qino/qino";
import type { Recipient, To } from "../mod.ts";

/** Resolve users to their main contact and given addresses to their owner (if any). */
export async function contactRecipients(
  app: App,
  type: string,
  to: To,
  direct: Recipient[] = [],
): Promise<Recipient[]> {
  // a group or everyone is a mass send: addresses known to bounce are left out; a user named is still tried
  const who = [
    ...selectors({ grp: to.grp, all: to.all }, "c.usr_id").map((term) => sql`(${term} AND c.error IS NULL)`),
    ...selectors({ usr: to.usr }, "c.usr_id"),
  ];
  if (!who.length && !direct.length) throw new Error("contact recipients need a selection or direct address");
  const preferred = who.length
    ? sql`(${sql.join(who, " OR ")}) AND c.address = (
      SELECT other.address FROM usr_contact other
      WHERE other.type = ${type} AND other.usr_id = c.usr_id
      ORDER BY other.main DESC, other.created, other.address LIMIT 1)`
    : null;
  const valid = direct.filter((recipient) => !recipient.addressError);
  const literal = valid.length
    ? sql.in("c.address", valid.map(({ address }) => address))
    : null;
  const found = new Map(direct.map((recipient) => [recipient.address, recipient]));
  const terms = [preferred, literal].filter(v => v != null);
  const rows = terms.length
    ? await app.db.query`SELECT c.* FROM usr_contact c WHERE c.type = ${type} AND (${sql.join(terms, " OR ")})`
    : [];
  for (const row of rows) {
    const address = String(row.address);
    found.set(address, { ...row, address, usrId: Number(row.usr_id) || undefined });
  }
  return [...found.values()];
}
