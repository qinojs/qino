import { assertEquals, assertStringIncludes } from "@std/assert";
import { App, Ctx, requestStorage } from "@qino/qino";

import nodeApi from "../nodeApi.ts";
import { cms as panel } from "../plugin.ts";

import type { Node } from "@qino/qino/cms";

async function app_() {
  const app = new App({ db: "sqlite::memory:", dir: await Deno.makeTempDir() + "/" });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms").add("cron").add("locale.currency");
  await app.init();
  return app;
}

// Access to the panel is the right to use it — write access is the only gate.
const call = (app: App, vars: Record<string, unknown>, access = 2) =>
  nodeApi({ access: () => Promise.resolve(access), app } as unknown as Node, vars);

Deno.test("backend.locale.currency: the daily job is switched from here", async () => {
  const app = await app_();
  try {
    assertEquals(String(await app.settings["locale.currency"].update), "never"); // reaching out is opt-in

    assertEquals(await call(app, { every: "daily" }), { every: "daily" });
    assertEquals(String(await app.settings["locale.currency"].update), "daily");

    assertEquals(await call(app, { every: "sometimes" }), false); // not a frequency
    assertEquals(await call(app, { every: "never" }, 1), false);  // read access only
    assertEquals(String(await app.settings["locale.currency"].update), "daily");
  } finally {
    await app.db.close();
  }
});

// What "now" does when it reaches the source is updateRates()' business and tested there.
Deno.test("backend.locale.currency: fetching by hand needs write access", async () => {
  const app = await app_();
  try {
    assertEquals(await call(app, { now: 1 }, 1), false);
    assertEquals(await call(app, { nonsense: 1 }), false);
  } finally {
    await app.db.close();
  }
});

Deno.test("backend.locale.currency: the panel lists what is stored", async () => {
  const app = await app_();
  try {
    await app.db.table("currency").update({ id: "CHF", rate_to_usd: 0.8 });
    await app.settings["locale.currency"].update("daily"); // read-only view
    const ctx = await Ctx.create(app, new Request("http://test/"), { appUrl: "/" });
    await requestStorage.run(ctx, async () => {
      const html = String(await panel.node.render({ app } as unknown as Node));
      assertEquals(html.includes("[object Promise]"), false);
      assertStringIncludes(html, "0.800000");
      assertStringIncludes(html, "Swiss Franc");
      assertStringIncludes(html, "never fetched");
      assertStringIncludes(html, "<option value=hourly"); // never / daily / hourly
    });
  } finally {
    await app.db.close();
  }
});

Deno.test("backend.locale.currency: every currency is listed, with its symbol", async () => {
  const app = await app_();
  try {
    const ctx = await Ctx.create(app, new Request("http://test/"), { appUrl: "/" });
    await requestStorage.run(ctx, async () => {
      const html = String(await panel.node.render({ app } as unknown as Node));
      assertEquals(html.includes("[object Promise]"), false);
      assertStringIncludes(html, "<td>JPY"); // not only the ones with a rate
      assertStringIncludes(html, "<td>€"); // a symbol where Intl has one
      assertStringIncludes(html, "<td>XDR\n    <td>Special Drawing Rights\n    <td>\n"); // and none where it has not
    });
  } finally {
    await app.db.close();
  }
});

Deno.test("backend.locale.currency: a rate can be set and cleared by hand", async () => {
  const app = await app_();
  try {
    assertEquals(await call(app, { rate: "chf", value: "0.8" }), 1); // lower case is a currency too
    assertEquals(await app.db.one`SELECT rate_to_usd FROM currency WHERE id = ${"CHF"}`, 0.8);

    assertEquals(await call(app, { rate: "CHF", value: "" }), 1); // empty is "no rate", not zero
    assertEquals(await app.db.one`SELECT rate_to_usd FROM currency WHERE id = ${"CHF"}`, null);

    assertEquals(await call(app, { rate: "QQQ", value: "1" }), false); // no such currency
    assertEquals(await call(app, { rate: "CHF", value: "1" }, 1), false); // read access only
  } finally {
    await app.db.close();
  }
});

Deno.test("backend.locale.currency: rates are editable while the job is off", async () => {
  const app = await app_();
  try {
    await app.db.table("currency").update({ id: "CHF", rate_to_usd: 0.8 });
    const ctx = await Ctx.create(app, new Request("http://test/"), { appUrl: "/" });
    await requestStorage.run(ctx, async () => {
      const render = () => panel.node.render({ app } as unknown as Node).then(String);
      const manual = await render();
      assertStringIncludes(manual, "class=-rate"); // "never": the rates are the admin's own

      await app.settings["locale.currency"].update("daily");
      const automatic = await render();
      assertEquals(automatic.includes("class=-rate"), false); // the job would overwrite it anyway
      assertStringIncludes(automatic, "0.800000");
    });
  } finally {
    await app.db.close();
  }
});
