import { addContact } from "@qino/qino";

import type { App } from "@qino/qino";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Legacy knows one address per user and never asked anyone to prove it. Taking it as verified is
 * the only alternative to leaving every migrated user unreachable, so that is the call made here —
 * once, in the migration, and nowhere in the running code. Addresses that are not addresses stay
 * behind; `usr.email` keeps them as the login handle.
 */
export async function migrateContacts(app: App): Promise<number> {
  const rows = await app.db.query`
    SELECT u.id, u.email FROM usr u
    WHERE u.email <> ${""} AND NOT EXISTS (
      SELECT 1 FROM usr_contact c WHERE c.usr_id = u.id AND c.channel = ${"email"})`;
  let taken = 0;
  for (const row of rows) {
    const address = String(row.email).trim().toLowerCase();
    if (!EMAIL_RE.test(address)) continue;
    // an address two accounts share belongs to the first — the second keeps it as a login only
    await addContact(app.db, Number(row.id), "email", address).then(() => taken++, () => {});
  }
  const phones = await app.db.query`SELECT usr_id, number, main, created FROM usr_phone`.catch(() => []);
  for (const row of phones) {
    await addContact(app.db, Number(row.usr_id), "sms", String(row.number)).catch(() => {});
  }
  if (phones.length) await app.db.exec`DROP TABLE usr_phone`;
  if (taken || phones.length) console.log(`[migrate_from_php] took over ${taken} mail and ${phones.length} phone contacts`);
  return taken;
}
