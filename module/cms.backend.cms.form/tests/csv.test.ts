import { App, runAs } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { assertEquals } from "@qino/qino/tests";

import { csv } from "../render.ts";

const quiet = { sanitizeOps: false, sanitizeResources: false };

Deno.test({ name: "form backend: the csv export keeps formulas as text, numbers as numbers", ...quiet, fn: async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms").add("cms.backend.cms.form");
  await app.init();
  try {
    await app.settings.core.url("https://example.test/");
    const su = Number(await app.db.table("usr").insert({ username: "su@example.test", active: 1, superuser: 1 }));
    const form = await (await (await cms(app).node(1)).createChild()).cont("main", "cms.cont.form");
    const data = { a: '=HYPERLINK("http://evil.test","x")', b: "+1", c: "-1", d: "@SUM(1)", e: "\tx", f: "\rx", g: "\nx", n: -5, ok: "plain" };
    await app.db.table("form_entry").insert({ node_id: form.id, created: 1, spam: 0, data: JSON.stringify(data) });
    const out = await runAs(app, su, "test", () => csv(app, form, ""));
    // the row after the head; a cell may hold a line break, so the head's end is where it starts
    const row = out.slice(out.indexOf("\r\n") + 2, -2).split(";").slice(2); // after received and spam
    assertEquals(row, [`"'=HYPERLINK(""http://evil.test"",""x"")"`, `"'+1"`, `"'-1"`, `"'@SUM(1)"`, `"'\tx"`, `"'\rx"`, `"'\nx"`, `"-5"`, `"plain"`]);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  }
} });
