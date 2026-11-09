import { test } from "node:test";
import { fs } from "@qino/qino";
import { assertEquals } from "@qino/qino/tests";

import { migrateCss } from "./migrateCss.ts";

import type { App } from "@qino/qino";

test("migrateCss: module and node classes become qcms attributes", async () => {
  const dir = await fs.tempDir() + "/";
  await fs.mkdir(dir + "data/site");
  const path = dir + "data/site/main.css";
  await fs.write(path, '.-pid123 .-m-cms-cont-form1, .-pid1234x { background:url(/qg/site/pub/a.svg) }');
  const app = { dir, db: { col: () => Promise.resolve(["cms.cont.form1"]) } } as unknown as App;

  await migrateCss(app);

  assertEquals(
    await fs.text(path),
    '[qcms-id="123"] [qcms-mod="cont.form"], .-pid1234x { background:url(pub/a.svg) }',
  );
});

test("migrateCss: a file inside the folder it names keeps a clean path", async () => {
  const dir = await fs.tempDir() + "/";
  await fs.mkdir(dir + "data/site/pub");
  const path = dir + "data/site/pub/main.css";
  await fs.write(path, "a { background:url(/qg/site/pub/img/a.svg) }");
  await migrateCss({ dir, db: { col: () => Promise.resolve([]) } } as unknown as App);
  assertEquals(await fs.text(path), "a { background:url(../pub/img/a.svg) }");
});
