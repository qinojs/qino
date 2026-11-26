import { test } from "node:test";
import { App, fs, getCtx, runAs } from "@qino/qino";
import { cms, cmsCtx } from "@qino/qino/cms";
import { assert, assertEquals, assertRejects } from "@qino/qino/tests";

import nodeApi from "../nodeApi.ts";


test("form.entries: a block shows a form's entries only once the form allows it", async () => {
  const dir = await fs.tempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms").add("cms.cont.form.entries");
  await app.init();
  try {
    await app.settings.core.url("https://example.test/");
    const su = Number(await app.db.table("usr").insert({ username: "su@example.test", active: 1, superuser: 1 }));
    const editor = Number(await app.db.table("usr").insert({ username: "ed@example.test", active: 1 }));
    const root = await cms(app).node(1);
    const form = await (await root.createChild()).cont("main", "cms.cont.form");
    const listing = await root.createChild();
    await listing.changeUser(editor, 2); // the editor may edit the listing's page, not the form's
    const block = await listing.cont("main", "cms.cont.form.entries");
    await app.db.table("form_entry").insert({ node_id: form.id, created: 1, spam: 0, data: JSON.stringify({ name: "Ada" }) });

    const shown = () => runAs(app, su, "test", async () => String(await (await cms(app).node(block.id)).html()));
    await runAs(app, su, "test", () => app.api.cms.node(block.id).settings(["form"]).put({ value: form.id }));
    assert(!(await shown()).includes("Ada"), "not allowed yet");
    const status = () => runAs(app, su, "test", async () => nodeApi(await cms(app).node(block.id), { status: true }));
    assertEquals(((await status()) as { form: number; allowed: boolean }).allowed, false, "the panel says so");

    const allow = () => app.api.cms.node(form.id).settings(["listing_nodes", String(block.id)]).put({ value: true });
    await assertRejects(() => runAs(app, editor, "test", allow), Error, undefined, "the block's editor cannot allow it");
    await runAs(app, su, "test", allow);
    assertEquals((await shown()).includes("Ada"), true, "who may edit the form can");
    assertEquals(((await status()) as { form: number; allowed: boolean }).allowed, true);
    const asked = (candidate: number) => runAs(app, su, "test", async () => nodeApi(await cms(app).node(block.id), { status: candidate }));
    assertEquals(((await asked(form.id)) as { form: number }).form, form.id, "a form chosen in the panel is checked");
    assertEquals(await asked(listing.id), { form: 0 }, "a page that is no form is none");
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100)); // background writes (the user's language)
    await app.db.close();
    await fs.remove(dir, { recursive: true });
  }
});

test("form.entries: waiting entries are for who may edit the form, spam for nobody", async () => {
  const dir = await fs.tempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms").add("cms.cont.form.entries");
  await app.init();
  try {
    await app.settings.core.url("https://example.test/");
    const su = Number(await app.db.table("usr").insert({ username: "su@example.test", active: 1, superuser: 1 }));
    const editor = Number(await app.db.table("usr").insert({ username: "ed@example.test", active: 1 }));
    const root = await cms(app).node(1);
    const form = await (await root.createChild()).cont("main", "cms.cont.form");
    const listing = await root.createChild();
    await listing.changeUser(editor, 2); // the editor may edit the listing's page, not the form's
    const block = await listing.cont("main", "cms.cont.form.entries");
    await runAs(app, su, "test", async () => {
      await app.api.cms.node(block.id).settings(["form"]).put({ value: form.id });
      await app.api.cms.node(block.id).settings(["moderated"]).put({ value: true });
      await app.api.cms.node(form.id).settings(["listing_nodes", String(block.id)]).put({ value: true });
    });
    const entry = (name: string, more: Record<string, unknown>) =>
      app.db.table("form_entry").insert({ node_id: form.id, created: 1, spam: 0, data: JSON.stringify({ name }), ...more });
    await entry("Ada", { released: 1 });
    await entry("Bob", {});
    await entry("Spam", { released: 1, spam: 0.9 });

    const shown = (usr: number) => runAs(app, usr, "test", async () => {
      cmsCtx(getCtx()).editmode = 1;
      return String(await (await cms(app).node(block.id)).html());
    });
    const asSu = await shown(su), asEditor = await shown(editor);
    assertEquals([asSu.includes("Ada"), asSu.includes("Bob"), asSu.includes("data-release")], [true, true, true]);
    assertEquals([asEditor.includes("Ada"), asEditor.includes("Bob"), asEditor.includes("data-release")], [true, false, false]);
    assertEquals([asSu.includes("Spam"), asEditor.includes("Spam")], [false, false]);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await fs.remove(dir, { recursive: true });
  }
});
