import { addContact, contactKey, unixTime } from "@qino/qino";

import type { App } from "@qino/qino";

/**
 * The PHP CMS had one unverified address per user. It is taken as verified — otherwise migrated
 * users would be unreachable. Only here, once. Non-addresses stay only as login name (`usr.username`).
 *
 * The flag ensures it runs once: otherwise repair() would restore addresses the user deleted since.
 */
export async function migrateContacts(app: App): Promise<number> {
  if (await app.settings.migrate_from_php.contacts) return 0;
  const rows = await app.db.query`
    SELECT u.id, u.username FROM usr u
    WHERE u.username <> ${""} AND NOT EXISTS (
      SELECT 1 FROM usr_contact c WHERE c.usr_id = u.id AND c.type = ${"email"})`;
  let taken = 0;
  for (const row of rows) {
    // an address two accounts share belongs to the first — the second keeps it as a login only
    const address = tryKey(String(row.username));
    if (address) await addContact(app.db, Number(row.id), "email", address).then(() => taken++, () => {});
  }
  await app.settings.migrate_from_php.contacts(unixTime());
  if (taken) console.log(`[migrate_from_php] took over ${taken} mail contacts`);
  return taken;
}

/** An address, or nothing — a legacy login handle is not required to be one. */
function tryKey(input: string): string | undefined {
  try { return contactKey("email", input); } catch { return; }
}
