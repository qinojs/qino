import { addContact, contactKey, unixTime } from "@qino/qino";

import type { App } from "@qino/qino";

/**
 * Legacy knows one address per user and never asked anyone to prove it. Taking it as verified is
 * the only alternative to leaving every migrated user unreachable, so that is the call made here —
 * once, in the migration, and nowhere in the running code. Anything that is not an address stays
 * behind; `usr.username` keeps it as the login handle.
 *
 * The flag is what makes it once: `usr.username` keeps the address forever, so without it a
 * repair() would hand back an address the user has since deleted — as a proven one, no less.
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
