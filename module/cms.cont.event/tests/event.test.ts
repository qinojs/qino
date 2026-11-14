import { test } from "node:test";
import { AccessError, App, fs, requestStorage } from "@qino/qino";
import { entries } from "@qino/qino/calendar";
import { cms as tree } from "@qino/qino/cms";
import { list } from "@qino/qino/cms.event";
import { assertEquals, assertRejects, assertStringIncludes, testContext } from "@qino/qino/tests";

import api from "../nodeApi.ts";
import { cms } from "../plugin.ts";

test("event content renders CMS texts and fixed blocks, scopes writes and preserves node visibility", async () => {
  const dir = await fs.tempDir() + "/", app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms.cont.event");
  await app.init();
  try {
    const userId = Number(await app.db.table("usr").insert({ username: "event-editor", superuser: true, pw: "", given_name: "Event", family_name: "Editor" }));
    const admin = await testContext({ app, userId, set: { app } }), viewer = await testContext({ app, set: { app, lang: "de" } });
    await admin.initSettings();
    await viewer.initSettings();
    const root = await tree(app).node(1);
    const [event, hidden, other] = await requestStorage.run(admin, async () => {
      const create = (access: number) => root.createChild({ module: "cms.cont.event", access, online_start: 0, online_end: 0 });
      return Promise.all([create(1), create(0), create(1)]);
    });
    await requestStorage.run(admin, async () => {
      await event.title("en", "Course <b>one</b>");
      await event.text("main", "en", "<p>Course description</p>");
      await event.text("location", "en", "<p>Hall &amp; garden</p>");
      event.settings.time_zone("Europe/Zurich");
      await app.db.flush();
      await api(event, { details: {
        address_street: " Main Street 1 ", address_postal_code: "01234", address_locality: "Town", address_country: "ch",
        price: 12.5, currency: "chf", performer: "Teacher <script>alert(1)</script>", language: "de-CH",
        external_link: "https://example.test/event?x=1&y=2", time_zone: "Pacific/Auckland",
      } });
      assertEquals(event.settings.time_zone(), "Europe/Zurich");
      assertEquals(event.settings.address_country(), "CH");
      assertEquals(event.settings.currency(), "CHF");
      await assertRejects(() => api(event, { details: { external_link: "javascript:alert(1)" } }));
      await assertRejects(() => api(event, { details: { external_link: "https://" } }));
      await assertRejects(() => api(event, { details: { price: -1 } }));
      await assertRejects(() => api(event, { details: { currency: "" } }));
      await assertRejects(() => api(event, { details: { language: "invalid_tag!" } }));
      await assertRejects(() => api(event, { details: { address_country: "CHE" } }));
      assertEquals(event.settings.external_link(), "https://example.test/event?x=1&y=2");
      await api(event, { save: { start: "2027-07-10T09:00:30", end: "2027-07-10T11:00:45" } });
      const saved = await api(event, { save: { start: "2027-07-12", end: "2027-07-13" } }) as { id: number };
      await api(hidden, { save: { start: "2027-07-12", end: "2027-07-13" } });
      const blocks = await api(event, { blocks: true }) as { id: number; start: string; localStart: string; allDay: boolean }[];
      assertEquals(blocks.length, 2);
      assertEquals(blocks[0].start, "2027-07-10T07:00:30Z");
      assertEquals(blocks[0].localStart, "2027-07-10T09:00:30");
      assertEquals(blocks[1].allDay, true);
      await assertRejects(() => api(event, { save: { start: "2027-03-28T02:30", end: "2027-03-28T04:00" } }), RangeError);
      await assertRejects(() => api(event, { save: { start: "2027-10-31T02:30", end: "2027-10-31T04:00" } }), RangeError);
      await assertRejects(() => api(event, { save: { start: "2027-07-12", end: "2027-07-12T12:00Z" } }), RangeError);
      await assertRejects(() => api(other, { save: { id: saved.id, start: "2027-07-14", end: "2027-07-15" } }));
      await api(other, { remove: saved.id });
      const first = await api(other, { save: { start: "2028-07-10T09:00", end: "2028-07-10T11:00", timeZone: "Europe/Zurich" } }) as { start: string };
      assertEquals(first.start, "2028-07-10T07:00:00Z");
      assertEquals(other.settings.time_zone(), "Europe/Zurich");
      assertEquals((await list(event)).length, 2);
    });
    await requestStorage.run(viewer, async () => {
      await assertRejects(() => api(event, { blocks: true }), AccessError);
      await assertRejects(() => api(event, { details: { price: 0, currency: "EUR" } }), AccessError);
      await assertRejects(() => api(hidden, { details: { performer: "Hidden" } }), AccessError);
      await assertRejects(() => api(event, { save: { start: "2027-07-14", end: "2027-07-15" } }), AccessError);
      const blocks = await list(event);
      await assertRejects(() => api(event, { remove: blocks[0].id }), AccessError);
      const items = await entries(viewer, { start: "2027-07-01", end: "2027-08-01", timeZone: "Europe/Zurich" });
      assertEquals(items.length, 2);
      assertEquals(items.map((item) => item.title), ["Course one", "Course one"]);
      const rendered = String(await cms.node.render(event, { ctx: viewer }));
      assertStringIncludes(rendered, "<article>");
      assertStringIncludes(rendered, "Course description");
      assertStringIncludes(rendered, "Hall &amp; garden");
      assertStringIncludes(rendered, "Main Street 1");
      assertStringIncludes(rendered, "01234 Town");
      assertStringIncludes(rendered, "CHF");
      assertStringIncludes(rendered, "12,50");
      assertStringIncludes(rendered, "Teacher &lt;script&gt;");
      assertEquals(rendered.includes("<script>"), false);
      assertStringIncludes(rendered, new Intl.DisplayNames("de", { type: "language" }).of("de-CH")!);
      assertStringIncludes(rendered, 'href="https://example.test/event?x=1&amp;y=2"');
      assertStringIncludes(rendered, 'datetime="2027-07-12"');
      assertStringIncludes(rendered, "12. Juli 2027");
      assertEquals(rendered.includes("Ganztägig"), false);
      assertEquals(rendered.includes('datetime="2027-07-13"'), false);
    });
    await requestStorage.run(admin, async () => {
      const blocks = await list(event);
      await api(event, { save: { id: blocks[1].id, start: "2027-07-14", end: "2027-07-16" } });
      assertEquals((await list(event))[1].end, "2027-07-16");
      const rendered = String(await cms.node.render(event, { ctx: viewer }));
      assertStringIncludes(rendered, "14.–15. Juli 2027");
      await api(event, { remove: blocks[0].id });
      assertEquals((await list(event)).length, 1);
      await api(event, { details: { price: 0 } });
      assertStringIncludes(String(await cms.node.render(event, { ctx: viewer })), "0,00");
      await api(event, { details: { price: null, currency: "", external_link: "" } });
      assertEquals(event.settings.price(), null);
      const cleared = String(await cms.node.render(event, { ctx: viewer }));
      assertEquals(cleared.includes("CHF"), false);
      assertEquals(cleared.includes('href="https://example.test/event'), false);
    });
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await fs.remove(dir, { recursive: true });
  }
});
