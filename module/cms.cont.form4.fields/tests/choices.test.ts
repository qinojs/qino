import { App, Ctx, requestStorage } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { assertStringIncludes } from "@qino/qino/tests";

Deno.test("choices are what the textarea wrote: no entities, no stripped markup, the empty first line kept", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms").add("cms.cont.form4.fields");
  await app.init();
  try {
    const node = await (await cms(app).node(1)).createCont({ module: "cms.cont.form4.fields" });
    await node.settings.fields.size.type("select");
    const ctx = await Ctx.create(app, new Request("http://qino.test/"), { appUrl: "/" });
    ctx.lang = app.languages.def;
    const out = await requestStorage.run(ctx, async () => {
      await node.text("size_options", ctx.lang, "\nA & B\n<3");
      return String(await node.htmlRaw());
    });
    assertStringIncludes(out, `<option selected></option>`);
    assertStringIncludes(out, `<option value="A &amp; B">A &amp; B</option>`);
    assertStringIncludes(out, `<option value="&lt;3">&lt;3</option>`);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
