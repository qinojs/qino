import { assertEquals, assertRejects } from "@std/assert";
import { invoke } from "@qino/qino";

import { asUser, users, withFinApp } from "../../tests/app.ts";
import { api } from "../api.ts";
import { subscribe } from "../mod.ts";

Deno.test("a user reads and ends their own subscriptions, changes nothing else", async () => {
  await withFinApp(["fin.payment", "fin.invoice", "fin.subscription"], async (app) => {
    const { anna, ben, boss } = await users(app);
    const values = { name: "Hosting", price: 24000, currency: "CHF", start: "2027-03-01" };
    const own = await subscribe(app, { ...values, usrId: anna });
    const other = await subscribe(app, { ...values, usrId: ben });
    const asAnna = (method: string, path: string, params?: Record<string, unknown>) =>
      asUser(app, anna, () => invoke(api, method, path, params));
    assertEquals((await asAnna("GET", "/subscriptions") as { id: number }[]).map((s) => s.id), [own]);
    await assertRejects(() => asAnna("GET", `/subscription/${other}`), Error, "no subscription");
    await assertRejects(() => asAnna("POST", `/subscription/${other}/cancel`), Error, "no subscription");
    await assertRejects(() => asAnna("PATCH", `/subscription/${own}`, { price: 1 }), Error, "Access denied");
    await assertRejects(() => asAnna("POST", "/bill"), Error, "Access denied");
    await asUser(app, anna, () => invoke(api, "POST", `/subscription/${own}/cancel`));
    const end = await app.db.one`SELECT end_date FROM subscription WHERE id = ${own}`;
    assertEquals(String(end).slice(0, 10), "2027-03-01");
    await asUser(app, boss, () => invoke(api, "PATCH", `/subscription/${other}`, { price: 20000 }));
    assertEquals(await app.db.one`SELECT price FROM subscription WHERE id = ${other}`, 20000);
  });
});
