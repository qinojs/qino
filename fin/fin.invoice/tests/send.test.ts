import { assertEquals } from "@std/assert";
import { today } from "@qino/qino/fin";
import { setTransport } from "@qino/qino/messaging.email";

import { withFinApp } from "../../tests/app.ts";
import { create, issue, send, setSent } from "../mod.ts";

Deno.test("sent: the first time it reaches someone, or as said by hand", async () => {
  await withFinApp(["fin.payment", "fin.invoice", "messaging", "messaging.email"], async (app) => {
    await app.settings["messaging.email"].address("office@atelier.test");
    const mails: unknown[] = [];
    setTransport(app, { send: (m) => (mails.push(m), Promise.resolve({ successful: true })) });
    const id = Number((await issue(app, await create(app, { currency: "CHF", lines: [{ name: "Design", price: 10000 }] })))?.id);
    const sent = () => app.db.one`SELECT sent FROM invoice WHERE id = ${id}`;
    assertEquals(await send(app, id), false); // nobody to send it to: no user, no address
    assertEquals(await sent(), null);
    assertEquals(await send(app, id, { email: "anna@example.com" }), true);
    assertEquals([mails.length, await sent()], [1, today()]);
    await setSent(app, id, "2026-10-01"); // by post, earlier
    await send(app, id, { email: "anna@example.com" }); // sent again: the first time stays
    assertEquals(await sent(), "2026-10-01");
    await setSent(app, id, null);
    assertEquals(await sent(), null);
  });
});
