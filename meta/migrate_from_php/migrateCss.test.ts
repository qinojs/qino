import { assertEquals } from "@qino/qino/tests";

import { migrateCss } from "./migrateCss.ts";

import type { App } from "@qino/qino";

Deno.test("migrateCss: module and node classes become qcms attributes", async () => {
  const appPATH = await Deno.makeTempDir() + "/";
  await Deno.mkdir(appPATH + "data/site", { recursive: true });
  const path = appPATH + "data/site/main.css";
  await Deno.writeTextFile(path, '.-pid123 .-m-cms-cont-form1, .-pid1234x { background:url(/qg/site/pub/a.svg) }');
  const app = { appPATH, db: { col: () => Promise.resolve(["cms.cont.form1"]) } } as unknown as App;

  await migrateCss(app);

  assertEquals(
    await Deno.readTextFile(path),
    '[qcms-id="123"] [qcms-mod="cont.form2"], .-pid1234x { background:url(pub/a.svg) }',
  );
});
