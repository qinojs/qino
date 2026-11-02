// deno-lint-ignore-file no-explicit-any
import { rm } from "node:fs/promises";
import { test } from "node:test";
import { fs, requestStorage } from "@qino/qino";
import { assertEquals } from "@qino/qino/tests";

import { codeFiles } from "../codeFiles.ts";

const fakeCtx = () => ({ dev: false, req: { appUrl: "/app/" }, res: { html: { styles: new Set<string>(), scripts: new Set<string>() } } });
const fakeNode = (dir: string) => ({
  id: 7,
  module: {
    data: `${dir}data/cms.cont.html/`,
    dataUrl: "/app/d/cms.cont.html/",
  },
});

const tmpDir = async () => await fs.tempDir() + "/";
const read = (path: string) => fs.text(path).catch(() => undefined);

test("codeFiles: source lies next to pub/, assets inside", async () => {
  const dir = await tmpDir();
  const files = codeFiles(fakeNode(dir) as any);
  assertEquals(files.src, `${dir}data/cms.cont.html/7.html`);
  assertEquals(files.css, `${dir}data/cms.cont.html/pub/7.css`);
  assertEquals(files.js, `${dir}data/cms.cont.html/pub/7.js`);
  await fs.remove(dir, { recursive: true });
});

test("codeFiles: create writes the initial content, existing files are kept", async () => {
  const dir = await tmpDir();
  const files = codeFiles(fakeNode(dir) as any);
  await files.create();
  assertEquals((await read(files.src))?.includes("cms-text=title"), true);
  assertEquals(await read(files.css), undefined);
  assertEquals(await read(files.js), undefined);
  await fs.write(files.src, "<div>first</div>");
  await files.create("css");
  assertEquals(await read(files.js), undefined);
  await files.create("js");
  assertEquals(await read(files.src), "<div>first</div>");
  assertEquals(await read(files.css), `/* root-elements attributes are generated at render-time: qcms-id="385" qcms-mod="cont.html" */
[qcms-id="7"] { /* nesting syntax */
}
`);
  assertEquals((await read(files.js))?.includes(`observe('[qcms-id="7"]')`), true);
  assertEquals((await read(files.js))?.includes("// const node = await api.cms.node(7).get();"), true); // api examples, commented out
  await fs.remove(dir, { recursive: true });
});

test("codeFiles: addAssets only links files that exist", async () => {
  const dir = await tmpDir();
  const files = codeFiles(fakeNode(dir) as any);
  const ctx = fakeCtx();
  await requestStorage.run(ctx as any, () => files.addAssets());
  assertEquals([...ctx.res.html.styles], []);
  assertEquals([...ctx.res.html.scripts], []);
  await files.create("css");
  await requestStorage.run(ctx as any, () => files.addAssets());
  assertEquals([...ctx.res.html.styles], ["/app/d/cms.cont.html/pub/7.css"]);
  assertEquals([...ctx.res.html.scripts], []);
  await rm(files.css);
  assertEquals(await fs.isFile(files.css), true); // a foreign remove stays unseen until ttl
  await fs.isFile(files.css, { ttl: 0 });
  ctx.res.html.styles.clear();
  await requestStorage.run(ctx as any, () => files.addAssets());
  assertEquals([...ctx.res.html.styles], []);
  await fs.remove(dir, { recursive: true });
});
