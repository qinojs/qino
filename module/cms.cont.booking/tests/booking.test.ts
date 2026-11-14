import { test } from "node:test";
import { AccessError, App, bildJsonItem, fs, requestStorage } from "@qino/qino";
import { cms as tree } from "@qino/qino/cms";
import { add, list } from "@qino/qino/cms.event";
import { assertEquals, assertRejects, assertStringIncludes, testContext } from "@qino/qino/tests";

import { book, bookings, cancel, slots } from "../mod.ts";
import { calendar } from "../calendar.ts";
import api from "../nodeApi.ts";
import { cms } from "../plugin.ts";

test("appointment booking isolates instances, enforces node rights, and serializes competing reservations", async () => {
  const dir = await fs.tempDir() + "/", app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms.cont.booking");
  await app.init();
  const context = async (userId = 0) => {
    const data = bildJsonItem(JSON.stringify({ core: { userId } }), () => {}).proxy;
    const ctx = await testContext({ app, userId, sess: { data }, set: { app } });
    await ctx.initSettings();
    return ctx;
  };
  try {
    const adminId = Number(await app.db.table("usr").insert({ username: "booking-admin", superuser: true, pw: "", given_name: "Admin", family_name: "Test" }));
    const ownerId = Number(await app.db.table("usr").insert({ username: "booking-owner", superuser: false, pw: "", given_name: "Owner", family_name: "Test" }));
    const admin = await context(adminId), owner = await context(ownerId), guest = await context(), other = await context();
    const tomorrow = Temporal.Now.plainDateISO("UTC").add({ days: 1 });
    const start = `${tomorrow}T09:00:00Z`, end = `${tomorrow}T11:00:00Z`;
    const period = { start: `${tomorrow}T00:00:00Z`, end: `${tomorrow.add({ days: 2 })}T00:00:00Z`, timeZone: "UTC" };
    const root = await tree(app).node(1);
    const [first, second, hidden] = await requestStorage.run(admin, async () => {
      const create = (access: number) => root.createChild({ module: "cms.cont.booking", access, online_start: 0, online_end: 0 });
      return Promise.all([create(1), create(1), create(0)]);
    });
    const offers = await requestStorage.run(admin, async () => {
      const ids = [];
      for (const node of [first, second, hidden]) {
        await node.title("en", `Booking ${node.id}`);
        node.settings.duration(30);
        ids.push(Number(await add(node, { start, end })));
        await add(node, { start: Temporal.Instant.from(start).add({ hours: 24 }).toString(), end: Temporal.Instant.from(end).add({ hours: 24 }).toString() });
      }
      await app.db.flush();
      return ids;
    });
    const available = await requestStorage.run(guest, () => slots(first, period));
    assertEquals(available.length, 8);
    await requestStorage.run(other, async () => {
      await assertRejects(() => slots(hidden, period), AccessError);
      await assertRejects(() => api(first, { offers: true }), AccessError);
      await assertRejects(() => api(first, { save: { start, end } }), AccessError);
      assertEquals(await list(hidden), []);
    });
    const input = { eventId: offers[0], start, name: "Guest <b>one</b>", email: "guest@example.test", timeZone: "UTC" };
    const reserved = await requestStorage.run(guest, () => book(first, input));
    assertEquals((await requestStorage.run(guest, () => bookings(first))).length, 1);
    assertEquals(await requestStorage.run(other, () => bookings(first)), []);
    await requestStorage.run(other, async () => {
      await assertRejects(() => book(first, input));
      await assertRejects(() => book(second, input));
      await assertRejects(() => cancel(first, reserved.id), AccessError);
      await assertRejects(() => cancel(second, reserved.id), AccessError);
    });
    assertEquals((await requestStorage.run(other, () => slots(second, period))).length, 8);

    const competing = { ...input, start: available[1].start };
    const attempts = await Promise.allSettled([
      requestStorage.run(guest, () => book(first, competing)), requestStorage.run(other, () => book(first, competing)),
    ]);
    assertEquals(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
    assertEquals(Number(await app.db.one`SELECT COUNT(*) FROM cms_booking WHERE node_id = ${first.id} AND cancelled = ${false}`), 2);
    await requestStorage.run(guest, () => cancel(first, reserved.id));
    assertEquals((await requestStorage.run(guest, () => slots(first, period))).some((slot) => slot.start === reserved.start), true);

    await requestStorage.run(admin, async () => { second.settings.duration(0); await app.db.flush(); });
    const fixed = await requestStorage.run(owner, () => slots(second, period));
    assertEquals(fixed.length, 2);
    const owned = await requestStorage.run(owner, () => book(second, { ...input, eventId: offers[1] }));
    assertEquals(Temporal.Instant.from(owned.start).until(Temporal.Instant.from(owned.end)).total("hours"), 2);
    assertEquals((await requestStorage.run(owner, () => calendar.query(owner, period))).map((item) => item.id), [String(owned.id)]);
    assertEquals(await requestStorage.run(other, () => calendar.query(other, period)), []);
    await requestStorage.run(admin, async () => {
      const before = await list(first);
      await assertRejects(() => api(second, { save: { id: offers[0], start, end, timeZone: "UTC" } }));
      assertEquals(await list(first), before);
      await assertRejects(() => api(second, { remove: offers[1] }));
      await second.set({ access: 0 });
    });
    const returning = await context(ownerId);
    await requestStorage.run(returning, async () => {
      assertEquals(await calendar.query(returning, period), []);
      await assertRejects(() => bookings(second), AccessError);
      await assertRejects(() => cancel(second, owned.id), AccessError);
    });
    await requestStorage.run(guest, async () => {
      const rendered = String(await cms.node.render(first, { ctx: guest, vars: {} }));
      assertStringIncludes(rendered, "name=slot");
      assertStringIncludes(rendered, "Guest &lt;b&gt;one&lt;/b&gt;");
      assertStringIncludes(rendered, "csrfToken");
    });
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await fs.remove(dir, { recursive: true });
  }
});
