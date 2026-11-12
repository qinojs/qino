import { test } from "node:test";
import { App, fs, requestStorage, unixTime } from "@qino/qino";
import { assert, assertEquals, assertStringIncludes, testContext } from "@qino/qino/tests";
import { setTransport } from "@qino/qino/messaging.email";

import { render, subscribe } from "../render.ts";

import type { Node } from "@qino/qino/cms";

const URL = "https://qino.test/backend/newsletter";

async function makeApp() {
  const dir = await fs.tempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms.backend.newsletter");
  await app.init();
  await app.settings["messaging.email"].address("news@qino.test");
  await app.settings.core.url("https://qino.test/");
  const mails: Record<string, unknown>[] = [];
  setTransport(app, { send: (message) => (mails.push(message as Record<string, unknown>), Promise.resolve({ successful: true, messageId: `<${mails.length}@qino.test>` })) });
  return { app, dir, mails };
}

/** Render the page as the backend would: GET, or POST with the form's fields. */
async function page(app: App, search: string, fields?: Record<string, string>) {
  const init = fields
    ? { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrfToken: "test", ...fields }) }
    : {};
  const ctx = await testContext({ url: URL + search, ...init, set: { csrfToken: "test" } });
  const out = String(await requestStorage.run(ctx, () => render({ app } as Node)));
  return { out, location: ctx.res.headers.get("Location") };
}

test("an import adds unknown addresses only, so an unsubscribe is not undone", async () => {
  const { app, dir } = await makeApp();
  try {
    const list = Number(await app.db.table("grp").insert({ name: "News", type: "newsletter" }));
    const known = Number(await app.db.table("usr").insert({ active: true, pw: "" }));
    await app.db.table("usr_contact").insert({ type: "email", address: "left@qino.test", usr_id: known, main: true, created: 1 });

    const result = await subscribe(app, list, "ada@qino.test\nAda Lovelace <Lovelace@Qino.test>\nnot an address\nleft@qino.test\n");
    assertEquals(result, { added: 2, known: ["left@qino.test"], invalid: ["not an address"] });
    assertEquals(await app.db.query`SELECT u.given_name, u.family_name, c.address, u.active FROM usr u
      JOIN usr_contact c ON c.usr_id = u.id JOIN usr_grp ug ON ug.usr_id = u.id WHERE ug.grp_id = ${list} ORDER BY c.address`, [
      { given_name: null, family_name: null, address: "ada@qino.test", active: 0 },
      { given_name: "Ada", family_name: "Lovelace", address: "lovelace@qino.test", active: 0 },
    ]);
    assertEquals(await app.db.one`SELECT COUNT(*) FROM usr_grp WHERE usr_id = ${known}`, 0, "known: left alone");

    const { out } = await page(app, `?list=${list}`);
    assertStringIncludes(out, "lovelace@qino.test");
    assertStringIncludes(out, "Ada Lovelace");
  } finally {
    await app.db.close();
    await fs.remove(dir, { recursive: true });
  }
});

test("a draft is a message without deliveries; sending makes them for the list as it is then", async () => {
  const { app, dir, mails } = await makeApp();
  try {
    const list = Number(await app.db.table("grp").insert({ name: "News", type: "newsletter" }));
    await subscribe(app, list, "one@qino.test\ntwo@qino.test");

    const created = await page(app, "", { createIssue: "1", grp: String(list) });
    const id = Number(created.location?.match(/issue=(\d+)/)?.[1]);
    assert(id, "a new issue opens in the editor");
    assertEquals(await app.db.one`SELECT COUNT(*) FROM message_delivery`, 0);

    await page(app, `?issue=${id}`, { save: "1", grp: String(list), title: "Hello", template: "", text: "<p>News</p>" });
    const editor = await page(app, `?issue=${id}`);
    assertStringIncludes(editor.out, "<u2-rte");
    assertStringIncludes(editor.out, "&lt;p&gt;News&lt;/p&gt;"); // the preview's srcdoc

    // a test goes to one address, outside the list
    await page(app, `?issue=${id}`, { test: "1", grp: String(list), title: "Hello", template: "", text: "<p>News</p>", address: "me@qino.test" });
    assertEquals(mails.length, 1);
    assertEquals(await app.db.one`SELECT COUNT(*) FROM message_delivery WHERE message_id = ${id}`, 0, "still a draft");

    // scheduled: deliveries wait in the outbox; cancelling makes it a draft again
    const later = unixTime() + 3600;
    await page(app, `?issue=${id}`, { schedule: "1", at: String(later), grp: String(list), title: "Hello", template: "", text: "<p>News</p>" });
    assertEquals(await app.db.col`SELECT due FROM message_delivery WHERE message_id = ${id}`, [later, later]);
    assertEquals(mails.length, 1);
    assertStringIncludes((await page(app, "")).out, "Scheduled");
    await page(app, `?issue=${id}`, { cancel: "1" });
    assertEquals(await app.db.one`SELECT COUNT(*) FROM message_delivery WHERE message_id = ${id}`, 0);

    await subscribe(app, list, "three@qino.test"); // joined after the draft was written
    await page(app, `?issue=${id}`, { send: "1", grp: String(list), title: "Hello", template: "", text: "<p>News</p>" });
    assertEquals(mails.length, 4);
    assertEquals(String(mails[3].subject), "Hello");
    const report = await page(app, `?issue=${id}`);
    assertStringIncludes(report.out, "three@qino.test");
    assertStringIncludes(report.out, "Sent");
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await app.db.close();
    await fs.remove(dir, { recursive: true });
  }
});
