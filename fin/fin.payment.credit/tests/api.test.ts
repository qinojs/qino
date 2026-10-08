import { assertEquals, assertRejects } from "@std/assert";
import { invoke } from "@qino/qino";

import { asUser, users, withFinApp } from "../../tests/app.ts";
import { api } from "../api.ts";

Deno.test("a user reads their own credit; a superuser adds to anyone's", async () => {
  await withFinApp(["fin.payment", "fin.payment.credit"], async (app) => {
    const { anna, ben, boss } = await users(app);
    const goodwill = { usrId: anna, amount: 5000, currency: "CHF", text: "Goodwill" };
    await asUser(app, boss, () => invoke(api, "POST", "/", goodwill));
    const own = await asUser(app, anna, () => invoke(api, "GET", "/")) as { balances: { amount: number }[] };
    assertEquals(own.balances.map((b) => b.amount), [5000]);
    // asking for another's, a user still gets their own
    const asked = await asUser(app, ben, () => invoke(api, "GET", "/", { usrId: anna })) as { balances: unknown[] };
    assertEquals(asked.balances, []);
    const add = { usrId: anna, amount: 100, currency: "CHF" };
    await assertRejects(() => asUser(app, anna, () => invoke(api, "POST", "/", add)), Error, "Access denied");
  });
});
