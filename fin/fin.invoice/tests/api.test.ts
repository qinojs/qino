import { assertEquals, assertRejects } from "@std/assert";
import { invoke } from "@qino/qino";

import { asUser, users, withFinApp } from "../../tests/app.ts";
import { api } from "../api.ts";
import { create, issue } from "../mod.ts";

import type { App } from "@qino/qino";

const withApp = (fn: (app: App, users: { anna: number; ben: number; boss: number }) => Promise<void>) =>
  withFinApp(["fin.payment", "fin.bank", "fin.payment.qrbill", "fin.invoice"], async (app) => {
    await app.settings["fin.payment.qrbill"].iban("CH44 3199 9123 0008 8901 2");
    await fn(app, await users(app));
  });

const draft = (app: App, usrId: number) =>
  create(app, { currency: "CHF", usrId, lines: [{ name: "Design", price: 10000 }] });

Deno.test("a user reads their own issued invoices, nobody else's, and no drafts", async () => {
  await withApp(async (app, { anna, ben }) => {
    const own = Number((await issue(app, await draft(app, anna)))?.id);
    const hidden = await draft(app, anna);
    const other = Number((await issue(app, await draft(app, ben)))?.id);
    const list = await asUser(app, anna, () => invoke(api, "GET", "/invoices")) as { id: number; data?: unknown }[];
    assertEquals(list.map((i) => i.id), [own]);
    assertEquals("data" in list[0], false); // what other modules keep is not theirs to see
    const one = await asUser(app, anna, () => invoke(api, "GET", `/invoice/${own}`)) as { lines: unknown[] };
    assertEquals(one.lines.length, 1);
    for (const id of [hidden, other]) {
      await assertRejects(() => asUser(app, anna, () => invoke(api, "GET", `/invoice/${id}`)), Error, "no invoice");
    }
    // signed out: nothing
    await assertRejects(() => asUser(app, 0, () => invoke(api, "GET", `/invoice/${own}`)), Error, "no invoice");
    await assertRejects(() => asUser(app, 0, () => invoke(api, "GET", "/invoices")), Error, "Access denied");
  });
});

Deno.test("a user pays what is open on their invoice, but changes nothing on it", async () => {
  await withApp(async (app, { anna }) => {
    const id = Number((await issue(app, await draft(app, anna)))?.id);
    const ways = await asUser(app, anna, () => invoke(api, "GET", `/invoice/${id}/methods`)) as { method: string }[];
    assertEquals(ways.map((w) => w.method), ["qrbill"]);
    const paid = await asUser(app, anna, () => invoke(api, "POST", `/invoice/${id}/pay`, { method: "qrbill" })) as {
      redirect: string;
    };
    assertEquals(paid.redirect.includes("/payment/pay/"), true);
    const asAnna = (method: string, path: string, params?: Record<string, unknown>) =>
      asUser(app, anna, () => invoke(api, method, path, params));
    await assertRejects(() => asAnna("POST", `/invoice/${id}/pay`, { method: "cash" }), Error, "not payable");
    for (const step of ["issue", "cancel", "revise", "creditNote"]) {
      await assertRejects(() => asAnna("POST", `/invoice/${id}/${step}`), Error, "Access denied");
    }
    await assertRejects(() => asAnna("PATCH", `/invoice/${id}`, { text: "x" }), Error, "Access denied");
    const pdf = await asUser(app, anna, () => invoke(api, "GET", `/invoice/${id}/pdf`)) as { url: string };
    assertEquals(pdf.url.startsWith("https://shop.test/"), true);
    assertEquals(new URL(pdf.url).searchParams.has("sig"), true); // signed: it needs no other right
  });
});

Deno.test("a superuser does anything: drafts, changes, issues, sees all", async () => {
  await withApp(async (app, { anna, ben, boss }) => {
    const as = <T>(fn: () => Promise<T>) => asUser(app, boss, fn);
    const values = { currency: "CHF", usrId: ben, lines: [{ name: "Hosting", price: 9900 }] };
    const id = await as(() => invoke(api, "POST", "/invoices", values));
    await as(() => invoke(api, "PATCH", `/invoice/${id}`, { lines: [{ name: "Hosting", price: 12000 }] }));
    const issued = await as(() => invoke(api, "POST", `/invoice/${id}/issue`)) as { status: string; total: number };
    assertEquals([issued.status, issued.total], ["open", 12000]);
    await draft(app, anna);
    assertEquals(await as(() => invoke(api, "GET", "/invoices")), []); // by default one's own: none
    assertEquals((await as(() => invoke(api, "GET", "/invoices", { all: true })) as unknown[]).length, 2); // drafts too
    assertEquals((await as(() => invoke(api, "GET", "/invoices", { usrId: ben })) as unknown[]).length, 1);
    const others = () => asUser(app, anna, () => invoke(api, "GET", "/invoices", { all: true }));
    await assertRejects(others, Error, "superuser");
  });
});
