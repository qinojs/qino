import { test } from "node:test";
import { AccessError, App, fs, Output, requestStorage } from "@qino/qino";
import { entries } from "@qino/qino/calendar";
import { cms as tree, cmsCtx } from "@qino/qino/cms";
import { get, list, set } from "@qino/qino/cms.event";
import { assertEquals, assertRejects, assertStringIncludes, testContext } from "@qino/qino/tests";

import api from "../nodeApi.ts";
import { cms } from "../plugin.ts";

test("event content is an event: renders its texts, details and dates, checks what is stored, scopes writes", async () => {
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
    // the module makes its nodes events: the row comes with the node
    assertEquals(await get(event), { id: event.id, time_zone: "", address_street: "", address_postal_code: "", address_locality: "",
      address_country: "", price: null, currency: "", performer: "", language: "", external_link: "", status: "", online_url: "" });
    await requestStorage.run(admin, async () => {
      await event.title("en", "Course <b>one</b>");
      await event.text("main", "en", "<p>Course description</p>");
      await event.text("location", "en", "<p>Hall &amp; garden</p>");
      await api(event, { set: {
        time_zone: "Europe/Zurich", address_street: " Main Street 1 ", address_postal_code: "01234", address_locality: "Town",
        address_country: "ch", price: 12.5, currency: "chf", performer: "Teacher <script>alert(1)</script>", language: "de-ch",
        external_link: "https://example.test/event?x=1&y=2",
      } });
      // stored as the standards write them, so whatever shows them can trust them
      const stored = await get(event);
      assertEquals([stored!.address_street, stored!.address_country, stored!.currency, stored!.language], ["Main Street 1", "CH", "CHF", "de-CH"]);
      for (const wrong of [{ currency: "C" }, { language: "invalid_tag!" }, { external_link: "javascript:alert(1)" }, { time_zone: "Mars/Olympus" }, { price: -1 }, { unknown: "x" }])
        await assertRejects(() => api(event, { set: wrong }));
      await api(event, { save: { start: "2027-07-10T09:00:30", end: "2027-07-10T11:00:45" } });
      const saved = await api(event, { save: { start: "2027-07-12", end: "2027-07-13" } }) as { id: number };
      await api(hidden, { save: { start: "2027-07-12", end: "2027-07-13" } });
      const { timeZone, dates } = await api(event, { get: true }) as { timeZone: string; dates: { id: number; start: string; localStart: string; allDay: boolean }[] };
      assertEquals(timeZone, "Europe/Zurich");
      assertEquals(dates.length, 2);
      assertEquals(dates[0].start, "2027-07-10T07:00:30Z");
      assertEquals(dates[0].localStart, "2027-07-10T09:00:30");
      assertEquals(dates[1].allDay, true);
      await assertRejects(() => api(event, { save: { start: "2027-03-28T02:30", end: "2027-03-28T04:00" } }), RangeError);
      await assertRejects(() => api(event, { save: { start: "2027-10-31T02:30", end: "2027-10-31T04:00" } }), RangeError);
      await assertRejects(() => api(event, { save: { start: "2027-07-12", end: "2027-07-12T12:00Z" } }), RangeError);
      await assertRejects(() => api(other, { save: { id: saved.id, start: "2027-07-14", end: "2027-07-15" } }));
      await api(other, { remove: saved.id });
      // without a zone of its own an event takes the site's; its own wins once set
      assertEquals((await api(other, { save: { start: "2028-07-10T09:00", end: "2028-07-10T11:00" } }) as { start: string }).start, "2028-07-10T09:00:00Z");
      await app.settings["cms.event"].time_zone("Europe/Zurich");
      assertEquals((await api(other, { save: { start: "2028-07-10T09:00", end: "2028-07-10T11:00" } }) as { start: string }).start, "2028-07-10T07:00:00Z");
      assertEquals((await api(other, { set: { time_zone: "America/New_York" } }) as { timeZone: string }).timeZone, "America/New_York");
      assertEquals((await api(other, { set: { time_zone: "" } }) as { timeZone: string }).timeZone, "Europe/Zurich");
      assertEquals((await list(event)).length, 2);
    });
    await requestStorage.run(viewer, async () => {
      await assertRejects(() => api(event, { get: true }), AccessError);
      await assertRejects(() => api(hidden, { set: { performer: "Hidden" } }), AccessError);
      await assertRejects(() => api(event, { save: { start: "2027-07-14", end: "2027-07-15" } }), AccessError);
      const dates = await list(event);
      await assertRejects(() => api(event, { remove: dates[0].id }), AccessError);
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
      assertStringIncludes(rendered, `?cms_event_ics=${event.id}`);
      // a page addressed by cmspid (edit mode) keeps it in its calendar link
      const addressed = await testContext({ app, url: `http://qino.test/?cmspid=${event.id}&lang=de`, set: { app, lang: "de" } });
      const linked = String(await requestStorage.run(addressed, () => cms.node.render(event, { ctx: addressed })));
      assertStringIncludes(linked, `?cmspid=${event.id}&amp;lang=de&amp;cms_event_ics=${event.id}`);
      // schema.org Event per date, only where the event is what the page is about
      assertEquals(viewer.res.html.head.includes('"@type":"Event"'), false);
      cmsCtx(viewer).requestedNode = event;
      const photo = await app.dbFiles.add(new File([new Uint8Array([137, 80, 78, 71])], "photo.png", { type: "image/png" }));
      await event.addFile(photo, "image");
      assertStringIncludes(String(await cms.node.render(event, { ctx: viewer })), "<cms-image");
      const data = [...viewer.res.html.head.matchAll(/<script type=application\/ld\+json>(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
      assertEquals(data.map((d) => [d.startDate, d.endDate]), [["2027-07-10T09:00:30+02:00", "2027-07-10T11:00:45+02:00"], ["2027-07-12", "2027-07-12"]]);
      assertEquals(data[0].location.address.postalCode, "01234");
      assertEquals(data[0].offers, { "@type": "Offer", price: "12.5", priceCurrency: "CHF", url: data[0].url });
      assertStringIncludes(data[0].image, `/dbFile/${photo.id}/`);
    });
    const download = await testContext({ app, url: `http://qino.test/?cms_event_ics=${event.id}`, set: { app } });
    await requestStorage.run(download, async () => {
      const out = await cms.node.render(event, { ctx: download }).then(() => undefined, (e: Output) => e);
      assertEquals(out instanceof Output, true);
      const body = String(out?.body);
      assertStringIncludes(body, "DTSTART:20270710T070030Z\r\nDTEND:20270710T090045Z\r\n");
      assertStringIncludes(body, "DTSTART;VALUE=DATE:20270712\r\nDTEND;VALUE=DATE:20270713\r\n");
      assertStringIncludes(body, "LOCATION:Hall & garden\\, Main Street 1\\, 01234 Town\\, CH\r\n");
    });
    // cancelled, online as well, a named date with its own price; the organizer is the site's
    await requestStorage.run(admin, async () => {
      await app.settings.identity.organization.name("Hall & Co");
      await app.settings.identity.contact.email("info@example.test");
      await set(event, { status: "cancelled", online_url: "https://meet.example.test/x" });
      await assertRejects(() => api(event, { set: { status: "maybe" } }));
      const dates = await list(event);
      await api(event, { save: { id: dates[1].id, start: dates[1].start, end: dates[1].end, name: "Module 1", price: 40 } });
      assertEquals((await list(event))[1].name, "Module 1");
      const page = await testContext({ app, set: { app, lang: "de" } });
      cmsCtx(page).requestedNode = event;
      const html = String(await requestStorage.run(page, () => cms.node.render(event, { ctx: page })));
      assertStringIncludes(html, "<strong>Abgesagt</strong>");
      assertStringIncludes(html, "Module 1: <time");
      assertStringIncludes(html, 'href="https://meet.example.test/x"');
      const data = [...page.res.html.head.matchAll(/<script type=application\/ld\+json>(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
      assertEquals(data[1].name, "Course one – Module 1");
      assertEquals(data[1].eventStatus, "https://schema.org/EventCancelled");
      assertEquals(data[1].eventAttendanceMode, "https://schema.org/MixedEventAttendanceMode");
      assertEquals(data[1].offers.price, "40");
      assertEquals(data[1].organizer.name, "Hall & Co");
      const feed = await testContext({ app, url: `http://qino.test/?cms_event_ics=${event.id}`, set: { app } });
      const out = await requestStorage.run(feed, () => cms.node.render(event, { ctx: feed }).then(() => undefined, (e: Output) => e));
      assertStringIncludes(String(out?.body), "SUMMARY:Course one – Module 1\r\n");
      assertStringIncludes(String(out?.body), "STATUS:CANCELLED\r\n");
      assertStringIncludes(String(out?.body), 'ORGANIZER;CN="Hall & Co":mailto:info@example.test\r\n');
      await set(event, { status: "", online_url: "" });
    });
    await requestStorage.run(admin, async () => {
      const dates = await list(event);
      await api(event, { save: { id: dates[1].id, start: "2027-07-14", end: "2027-07-16" } });
      assertEquals((await list(event))[1].end, "2027-07-16");
      const rendered = String(await cms.node.render(event, { ctx: viewer }));
      assertStringIncludes(rendered, "14.–15. Juli 2027");
      await api(event, { remove: dates[0].id });
      assertEquals((await list(event)).length, 1);
      await set(event, { price: 0 });
      assertStringIncludes(String(await cms.node.render(event, { ctx: viewer })), "0,00");
      await set(event, { price: null, currency: "", external_link: "" });
      const cleared = String(await cms.node.render(event, { ctx: viewer }));
      assertEquals(cleared.includes("CHF"), false);
      assertEquals(cleared.includes('href="https://example.test'), false);
    });
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await fs.remove(dir, { recursive: true });
  }
});
