import { addContact, pwHash } from "@qino/qino";

import type { Seed } from "../seed.ts";

/** Every demo user has this password — the module is a test fixture, never a production install. */
export const PW = "demo";
/** A reserved domain (RFC 2606): no demo mail can ever reach anyone. */
const DOMAIN = "@demo.example";

export async function run(s: Seed): Promise<void> {
  const pw = await pwHash(PW);
  const langs = s.app.languages.all;
  const taken = new Set<string>();
  const groups = [...s.grps.values()];

  for (let i = 0; i < s.many(40); i++) {
    const { firstname, lastname, company } = s.rnd.person();
    let email = `${firstname}.${lastname}`.toLowerCase() + DOMAIN;
    while (taken.has(email)) email = `${firstname}.${lastname}${taken.size}`.toLowerCase() + DOMAIN;
    taken.add(email);

    const id = Number(await s.db.table("usr").insert({
      email, pw, firstname, lastname,
      company: s.rnd.chance(0.4) ? company : "",
      lang: s.rnd.pick(langs),
      active: s.rnd.chance(0.9),
      superuser: false,
    }));
    if (!id) continue;
    // the address is the login handle and, for a demo user, their verified contact as well
    await addContact(s.db, id, "email", email);
    s.usrs.push({ id, email, firstname, lastname });
    s.count("users");

    for (const grp of s.rnd.some(groups, s.rnd.int(0, 3))) {
      await s.db.table("usr_grp").insert({ usr_id: id, grp_id: grp });
      s.count("memberships");
    }
    // a few accounts that have been locked out — the login backoff has something to show
    if (s.table("usr_auth_attempt") && s.rnd.chance(0.1)) {
      await s.db.table("usr_auth_attempt").insert({ usr_id: id, fails: s.rnd.int(1, 7), last: s.rnd.past(30, s.now) });
    }
  }
}
