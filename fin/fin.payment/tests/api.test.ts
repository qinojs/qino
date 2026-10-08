import { assertEquals, assertRejects } from "@std/assert";
import { invoke } from "@qino/qino";

import { asUser, users, withFinApp } from "../../tests/app.ts";
import { api } from "../api.ts";
import { record } from "../mod.ts";

Deno.test("a user reads their own payments and changes none; a superuser records and pays back", async () => {
  await withFinApp(["fin.payment"], async (app) => {
    const { anna, ben, boss } = await users(app);
    const own = await record(app, { direction: "in", provider: "cash", amount: 1000, currency: "CHF", usrId: anna });
    const other = await record(app, { direction: "in", provider: "cash", amount: 2000, currency: "CHF", usrId: ben });
    const list = await asUser(app, anna, () => invoke(api, "GET", "/payments")) as { id: number }[];
    assertEquals(list.map((p) => p.id), [own]);
    const one = await asUser(app, anna, () => invoke(api, "GET", `/payment/${own}`)) as { amount: number };
    assertEquals(one.amount, 1000);
    await assertRejects(() => asUser(app, anna, () => invoke(api, "GET", `/payment/${other}`)), Error, "no payment");
    // paid is what a provider or the bank says, never the payer
    const recorded = { direction: "in", provider: "cash", amount: 500, currency: "CHF", usrId: anna };
    const call = () => asUser(app, anna, () => invoke(api, "POST", "/payments", recorded));
    await assertRejects(call, Error, "Access denied");
    for (const step of ["sync", "cancel", "refund"]) {
      const call = () => asUser(app, anna, () => invoke(api, "POST", `/payment/${own}/${step}`));
      await assertRejects(call, Error, "Access denied");
    }
    const id = await asUser(app, boss, () => invoke(api, "POST", "/payments", recorded));
    assertEquals((await asUser(app, boss, () => invoke(api, "GET", "/payments")) as unknown[]).length, 3);
    assertEquals(await app.db.one`SELECT status FROM payment WHERE id = ${id}`, "paid");
  });
});
