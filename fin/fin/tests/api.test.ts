import { assertEquals, assertRejects } from "@std/assert";
import { invoke } from "@qino/qino";

import { asUser, users, withFinApp } from "../../tests/app.ts";
import { api } from "../api.ts";

Deno.test("a user reads their own IBAN; only a superuser sets it", async () => {
  await withFinApp([], async (app) => {
    const { anna, ben, boss } = await users(app);
    const iban = { usrId: anna, iban: "CH44 3199 9123 0008 8901 2" };
    await assertRejects(() => asUser(app, anna, () => invoke(api, "PUT", "/iban", iban)));
    await asUser(app, boss, () => invoke(api, "PUT", "/iban", iban));
    const own = await asUser(app, anna, () => invoke(api, "GET", "/iban")) as Record<string, unknown>;
    assertEquals(own.iban, "CH4431999123000889012");
    // another's is out of reach
    await assertRejects(() => asUser(app, ben, () => invoke(api, "GET", "/iban", { usrId: anna })), Error, "superuser");
  });
});
