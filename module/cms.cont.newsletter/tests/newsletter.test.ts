import { test } from "node:test";
import { App, fs } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { assert, assertEquals, assertRejects, assertStringIncludes } from "@qino/qino/tests";
import { issue, redeem } from "@qino/qino/ticket";
import { setTransport } from "@qino/qino/messaging.email";

const PURPOSE = "cms.cont.newsletter.confirm";

test("newsletter confirmation only joins the node's allowed newsletter group", async () => {
  const dir = await fs.tempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms.cont.newsletter");
  await app.init();
  try {
    const newsletter = Number(await app.db.table("grp").insert({ name: "News", type: "newsletter" }));
    const privateGrp = Number(await app.db.table("grp").insert({ name: "Staff", type: "staff" }));
    const otherNews = Number(await app.db.table("grp").insert({ name: "Other news", type: "newsletter" }));
    await app.settings["cms.cont.newsletter"].allowed_groups(String(newsletter));
    const node = await (await cms(app).node(1)).cont("main", "cms.cont.newsletter");
    await node.settings({ grp_id: newsletter, group_label: "News" });

    const data = { address: "person@example.test", grpId: newsletter, nodeId: node.id };
    const handle = await issue(app, PURPOSE, data);
    assertEquals(await app.db.one`SELECT COUNT(*) FROM usr_grp`, 0);
    await redeem(app, handle, PURPOSE);
    assertEquals(await app.db.one`SELECT COUNT(*) FROM usr_grp WHERE grp_id = ${newsletter}`, 1);
    assertEquals(await app.db.one`SELECT COUNT(*) FROM usr_grp WHERE grp_id = ${privateGrp}`, 0);
    assertEquals(await app.db.one`SELECT active FROM usr`, 0);
    assertEquals(await app.db.one`SELECT address FROM usr_contact`, data.address);
    await assertRejects(() => redeem(app, handle, PURPOSE));

    const forbidden = await issue(app, PURPOSE, { ...data, grpId: privateGrp });
    await assertRejects(() => redeem(app, forbidden, PURPOSE));
    const unlisted = await issue(app, PURPOSE, { ...data, grpId: otherNews });
    await assertRejects(() => redeem(app, unlisted, PURPOSE));
    assertEquals(await app.db.one`SELECT COUNT(*) FROM usr_grp`, 1);

    const old = await issue(app, PURPOSE, data);
    await node.settings.grp_id(otherNews);
    await assertRejects(() => redeem(app, old, PURPOSE));
    assertEquals(await app.db.one`SELECT COUNT(*) FROM usr_grp`, 1);
    await node.settings.grp_id(newsletter);
    await node.settings.group_label("Other news");
    const mismatched = await issue(app, PURPOSE, data);
    await assertRejects(() => redeem(app, mismatched, PURPOSE));
  } finally {
    await app.db.close();
    await fs.remove(dir, { recursive: true });
  }
});

test("newsletter form needs a mail confirmation and ignores submitted group IDs", async () => {
  const dir = await fs.tempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms.cont.newsletter").add("cms.layout.standard.2");
  await app.init();
  try {
    app.languages.setLangs(["de", "en"]);
    await app.settings.core.url("https://qino.test/");
    const group = Number(await app.db.table("grp").insert({ name: "News", type: "newsletter" }));
    const staff = Number(await app.db.table("grp").insert({ name: "Staff", type: "staff" }));
    await app.settings["cms.cont.newsletter"].allowed_groups(String(group));
    const page = await (await cms(app).node(1)).createChild({ access: 1, searchable: true });
    await page.title("de", "Newsletter");
    const node = await page.cont("main", "cms.cont.newsletter");
    await node.settings({ grp_id: group, group_label: "News" });
    const url = "https://qino.test/" + await page.urlSeo("de");
    assertStringIncludes(await (await app.fetch(new Request(url))).text(), "Die Newsletter-Anmeldung ist derzeit nicht verfügbar.");
    await app.settings["messaging.email"].address("news@qino.test");
    const mails: Record<string, unknown>[] = [];
    setTransport(app, { send: (message) => {
      mails.push(message as Record<string, unknown>);
      return Promise.resolve({ successful: true });
    } });
    const shown = await app.fetch(new Request(url));
    const initial = await shown.text();
    assertStringIncludes(initial, "Newsletter abonnieren");
    const token = initial.match(/name=csrfToken value="([^"]+)"/)?.[1];
    assert(token);
    const cookie = shown.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const post = (target: string, body: URLSearchParams) => app.fetch(new Request(target, {
      method: "POST", headers: { origin: "https://qino.test", cookie }, body,
    }));
    const submitted = await post(url, new URLSearchParams({
      "qcms-node": String(node.id), csrfToken: token, subscribe: "1", email: "Person@Example.test", grp_id: String(staff),
    }));
    assertStringIncludes(await submitted.text(), "Bestätigungslink unterwegs");
    for (let i = 0; i < 40 && !mails.length; i++) await new Promise((resolve) => setTimeout(resolve, 25));
    assertEquals(mails.length, 1);
    assertEquals(String(mails[0].subject), "Newsletter-Anmeldung bestätigen");
    assertEquals(await app.db.one`SELECT COUNT(*) FROM usr_grp`, 0);
    const link = JSON.stringify(mails[0]).match(/https:\/\/qino\.test\/[^"\s]+cms_newsletter_token=[A-Za-z0-9_-]+/)?.[0];
    assert(link);
    const confirmUrl = link.replace(/\\n.*$/, "");
    const confirmPage = await app.fetch(new Request(confirmUrl, { headers: { cookie } }));
    const confirmHtml = await confirmPage.text();
    assertStringIncludes(confirmHtml, "Newsletter-Anmeldung bestätigen");
    assertEquals(await app.db.one`SELECT COUNT(*) FROM usr_grp`, 0);
    const confirmToken = confirmHtml.match(/name=csrfToken value="([^"]+)"/)?.[1];
    const handle = new URL(confirmUrl).searchParams.get("cms_newsletter_token");
    assert(confirmToken && handle);
    const confirmed = await post(confirmUrl, new URLSearchParams({
      "qcms-node": String(node.id), csrfToken: confirmToken, confirm: handle, grp_id: String(staff),
    }));
    assertStringIncludes(await confirmed.text(), "Newsletter-Anmeldung ist bestätigt");
    assertEquals(await app.db.one`SELECT COUNT(*) FROM usr_grp WHERE grp_id = ${group}`, 1);
    assertEquals(await app.db.one`SELECT COUNT(*) FROM usr_grp WHERE grp_id = ${staff}`, 0);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await fs.remove(dir, { recursive: true });
  }
});
