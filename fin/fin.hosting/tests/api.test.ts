import { assertEquals, assertRejects } from "@std/assert";
import { invoke } from "@qino/qino";
import { subscribe } from "@qino/qino/fin.subscription";

import { asUser, users, withFinApp } from "../../tests/app.ts";
import { api } from "../api.ts";
import { link, save } from "../mod.ts";

Deno.test("fin.hosting: a user reads their own domains with what they are billed by, keeps none", async () => {
  await withFinApp(["fin.payment", "fin.invoice", "fin.subscription", "fin.hosting"], async (app) => {
    const { anna, ben, boss } = await users(app);
    await save(app, "anna.ch", { usrId: anna });
    await save(app, "ben.ch", { usrId: ben });
    const sub = await subscribe(app, { usrId: anna, name: "Hosting", price: 24000, currency: "CHF", start: "2027-01-01" });
    await link(app, "anna.ch", sub);
    const asAnna = (method: string, path: string, params?: Record<string, unknown>) =>
      asUser(app, anna, () => invoke(api, method, path, params));

    const own = await asAnna("GET", "/domains") as { name: string; subscriptions: { id: number }[] }[];
    assertEquals(own.map((d) => [d.name, d.subscriptions.map((s) => s.id)]), [["anna.ch", [sub]]]);
    await assertRejects(() => asAnna("GET", "/domain/ben.ch"), Error, "no domain");
    await assertRejects(() => asAnna("GET", "/domains", { all: true }), Error, "superuser");
    await assertRejects(() => asAnna("POST", "/domains", { name: "x.ch" }), Error, "Access denied");
    await assertRejects(() => asAnna("DELETE", "/domain/anna.ch"), Error, "Access denied");

    await asUser(app, boss, () => invoke(api, "POST", "/domains", { name: "anna.com", aliasOf: "anna.ch" }));
    const all = await asUser(app, boss, () => invoke(api, "GET", "/domains", { all: true })) as { name: string }[];
    assertEquals(all.map((d) => d.name), ["anna.ch", "anna.com", "ben.ch"]);
    await asUser(app, boss, () => invoke(api, "DELETE", "/domain/anna.com"));
    await assertRejects(() => asUser(app, boss, () => invoke(api, "DELETE", "/domain/anna.ch")), Error, "running");
  });
});
