import { App, runAs } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { assert, assertEquals } from "@qino/qino/tests";
import { strFromU8, unzipSync } from "fflate";

import nodeApi from "../nodeApi.ts";

const quiet = { sanitizeOps: false, sanitizeResources: false };

Deno.test({ name: "form backend: entries export as Excel for people, as CSV for machines", ...quiet, fn: async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms").add("cms.backend.cms.form");
  await app.init();
  try {
    await app.settings.core.url("https://example.test/");
    const su = Number(await app.db.table("usr").insert({ username: "su@example.test", active: 1, superuser: 1 }));
    const root = await cms(app).node(1);
    const form = await (await root.createChild()).cont("main", "cms.cont.form");
    await app.db.table("form_entry").insert({ node_id: form.id, created: 1, spam: 0, data: JSON.stringify({ a: "=SUM(1)", n: -5 }) });
    const exported = (format?: string) => runAs(app, su, "test", async () => await nodeApi(root, { export: form.id, format }));
    const bytes = (res: { data: string }) => Uint8Array.fromBase64(res.data);

    const excel = await exported();
    assertEquals(excel.name, `form-${form.id}.xlsx`, "Excel unless CSV is asked for");
    const sheet = strFromU8(unzipSync(bytes(excel))["xl/worksheets/sheet1.xml"]);
    assert(sheet.includes(">=SUM(1)</t>") && sheet.includes("<v>-5</v>") && !sheet.includes("<f>"));

    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes(await exported("csv"))); // keeps the BOM
    assert(text.startsWith("\uFEFF") && text.includes(`"'=SUM(1)","-5"`), text);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  }
} });
