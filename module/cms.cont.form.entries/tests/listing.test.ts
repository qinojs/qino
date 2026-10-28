import { App, runAs } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { assert, assertEquals, assertRejects } from "@qino/qino/tests";

import nodeApi from "../nodeApi.ts";

const quiet = { sanitizeOps: false, sanitizeResources: false };

Deno.test({ name: "form.entries: a block shows a form's entries only once the form allows it", ...quiet, fn: async () => {
  const dir = await Deno.makeTempDir() + "/";
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
    await Deno.remove(dir, { recursive: true });
  }
} });
