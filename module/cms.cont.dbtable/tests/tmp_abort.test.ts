import { App } from "@qino/qino";
import { cms } from "@qino/qino/cms";

for (const variant of ["delete", "delete+order", "order", "delete+text"]) {
  Deno.test("tmp: " + variant, async () => {
    const dir = await Deno.makeTempDir() + "/";
    const app = new App({ db: "sqlite::memory:", dir });
    app.stores.add(import.meta.resolve("../../store.json")).add("cms").add("cms.cont.dbtable");
    await app.init();
    const page = await (await cms(app).node(1)).createChild({ access: 1 });
    const node = await page.createCont({ module: "cms.cont.dbtable", settings: { table: "page", field_order: "a", fields: { a: {} } } });
    await node.settings.fields.x({ type: "text" });
    await node.settings.field_order("a,x");
    if (variant.includes("delete")) delete node.settings.fields.x;
    if (variant.includes("order")) await node.settings.field_order(String(await node.settings.field_order).split(",").filter((n) => n !== "x").join(","));
    if (variant.includes("text")) await node.textDelete("x_title");
    await new Promise((r) => setTimeout(r, 300));
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  });
}
