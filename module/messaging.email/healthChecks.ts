import type { App } from "@qino/qino";

/** Users without a mail contact can't be reached (no reset, codes, notifications). `usr.username`
 *  is the login name and not used for this. */
export function healthChecks(app: App) {
  return { notice: {

    "users without an email contact": async () => {
      const missing = Number(await app.db.one`
        SELECT COUNT(*) FROM usr u
        WHERE NOT EXISTS (SELECT 1 FROM usr_contact c WHERE c.usr_id = u.id AND c.type = ${"email"})`.catch(() => 0));
      if (!missing) return;
      return { info: `${missing} of them — they receive nothing by mail until an address of theirs is verified` };
    },

  } };
}
