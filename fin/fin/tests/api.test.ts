import { assertEquals, assertRejects } from "@std/assert";
import { invoke } from "@qino/qino";

import { asUser, users, withFinApp } from "../../tests/app.ts";
import { api } from "../api.ts";

Deno.test("a user keeps their own address; the IBAN only a superuser sets", async () => {
  await withFinApp([], async (app) => {
    const { anna, ben, boss } = await users(app);
    await asUser(app, anna, () => invoke(api, "PUT", "/address", { streetAddress: "Seeweg 2", addressCountry: "ch" }));
    const own = await asUser(app, anna, () => invoke(api, "GET", "/address")) as Record<string, unknown>;
    assertEquals([own.streetAddress, own.addressCountry], ["Seeweg 2", "CH"]);
    // another's is out of reach: asked for, a user gets and changes their own
    await asUser(app, ben, () => invoke(api, "PUT", "/address", { usrId: anna, streetAddress: "Elsewhere" }));
    assertEquals(await app.db.one`SELECT street_address FROM usr WHERE id = ${anna}`, "Seeweg 2");
    const iban = { iban: "CH44 3199 9123 0008 8901 2" };
    await assertRejects(() => asUser(app, anna, () => invoke(api, "PUT", "/address", iban)), Error, "superuser");
    await asUser(app, boss, () => invoke(api, "PUT", "/address", { ...iban, usrId: anna }));
    assertEquals(await app.db.one`SELECT iban FROM usr WHERE id = ${anna}`, "CH4431999123000889012");
  });
});
