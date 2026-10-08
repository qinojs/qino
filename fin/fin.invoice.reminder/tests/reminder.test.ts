import { assertEquals, assertStringIncludes } from "@std/assert";
import { addDays, today } from "@qino/qino/fin";
import { create, issue } from "@qino/qino/fin.invoice";
import { setTransport } from "@qino/qino/messaging.email";

import { withFinApp } from "../../tests/app.ts";
import { remind, remindDue } from "../mod.ts";

// on the server's calendar, as the reminders count
const day = (n: number) => addDays(today(), n);

const MODULES = ["fin.payment", "fin.invoice", "messaging", "messaging.email", "fin.invoice.reminder"];

Deno.test("overdue invoices are reminded in levels, apart, and only their users", async () => {
  await withFinApp(MODULES, async (app) => {
    app.languages.setLangs(["en", "de"]);
    await app.settings["messaging.email"].address("office@atelier.test");
    const sent: Record<string, unknown>[] = [];
    setTransport(app, {
      send: (m) => (sent.push(m as Record<string, unknown>), Promise.resolve({ successful: true })),
    });
    const usr = Number(await app.db.table("usr").insert({
      active: 1, pw: "", superuser: 0, given_name: "Anna", family_name: "Muster",
    }));
    await app.db.table("usr_contact").insert({ type: "email", address: "anna@example.com", usr_id: usr, main: 1 });
    const lines = [{ name: "Design", price: 10000 }];
    // long overdue: 40 days
    const old = Number((await issue(app, await create(app, {
      currency: "CHF", lang: "de", usrId: usr, lines, date: day(-70), due: day(-40),
    })))?.id);
    const issued = async (values: Record<string, unknown>) =>
      Number((await issue(app, await create(app, { currency: "CHF", lines, ...values })))?.id);
    const fresh = await issued({ usrId: usr, due: day(-5) });
    const nobody = await issued({ due: day(-40) });

    assertEquals(await remindDue(app), 1); // only the old one: the fresh is 5 days over, the other has no user
    const number = (await app.db.row`SELECT number FROM invoice WHERE id = ${old}`)?.number;
    assertEquals(String(sent[0].subject), `Zahlungserinnerung ${number}`);
    assertEquals(await remindDue(app), 0); // the next one only 10 days after this one
    await app.db.exec`UPDATE invoice SET reminded = ${day(-10)} WHERE id = ${old}`;
    assertEquals(await remindDue(app), 1);
    assertStringIncludes(String(sent[1].subject), "1. Mahnung");
    assertEquals((await app.db.row`SELECT reminder FROM invoice WHERE id = ${old}`)?.reminder, 2);

    assertEquals(await remind(app, fresh), 1); // at once, by hand
    assertEquals(await remind(app, nobody), 0);
  });
});
