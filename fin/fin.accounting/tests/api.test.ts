import { assertEquals, assertRejects } from "@std/assert";
import { invoke } from "@qino/qino";

import { asUser, users, withFinApp } from "../../tests/app.ts";
import { api } from "../api.ts";

Deno.test("the books are a superuser's: a user reads and books nothing", async () => {
  await withFinApp(["fin.payment", "fin.invoice", "fin.accounting", "fin.accounting.ch"], async (app) => {
    const { anna, boss } = await users(app);
    const lines = [{ account: "6000", amount: 1000 }, { account: "1020", amount: -1000 }];
    const entry = { date: "2026-10-01", text: "Rent", lines };
    for (const [method, path] of [["GET", "/accounts"], ["GET", "/entries"], ["POST", "/reopen"]]) {
      await assertRejects(() => asUser(app, anna, () => invoke(api, method, path)), Error, "Access denied");
    }
    await assertRejects(() => asUser(app, anna, () => invoke(api, "POST", "/entries", entry)), Error, "Access denied");
    const id = Number(await asUser(app, boss, () => invoke(api, "POST", "/entries", entry)));
    const back = Number(await asUser(app, boss, () => invoke(api, "POST", `/entry/${id}/reverse`, {})));
    const journal = await asUser(app, boss, () => invoke(api, "GET", "/entries")) as { id: number; lines: unknown[] }[];
    assertEquals(journal.map((e) => [e.id, e.lines.length]), [[back, 2], [id, 2]]);
  });
});
