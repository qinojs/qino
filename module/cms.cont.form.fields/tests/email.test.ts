import { App, Ctx, requestStorage } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { openForm } from "@qino/qino/cms.cont.form4";
import { assertEquals, assertStringIncludes } from "@qino/qino/tests";

Deno.test("an e-mail field refuses what is no address — the mail would fail for the site owner too", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms").add("cms.cont.form4");
  await app.init();
  try {
    const node = await (await cms(app).node(1)).createCont({ module: "cms.cont.form4.fields" });
    await node.settings.fields.mail.type("email");
    for (const [posted, errors, replyTo] of [["nope", 1, ""], ["a@b.ch", 0, "a@b.ch"]] as const) {
      const ctx = await Ctx.create(app, new Request("http://qino.test/"), { appUrl: "/" });
      const form = await requestStorage.run(ctx, async () => {
        const form = openForm(node);
        form.posted = { mail: posted };
        const out = String(await node.htmlRaw());
        if (errors) assertStringIncludes(out, "valid e-mail address");
        return form;
      });
      assertEquals([form.errors, form.replyTo], [errors, replyTo]);
    }
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
