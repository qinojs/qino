// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "../../core/tests/deps.ts";
import { requestStorage } from "../../core/mod.ts";
import { codeFiles } from "../codeFiles.ts";

const fakeCtx = () => ({ req: { basePath: "/app/" }, res: { html: { styles: new Set<string>(), scripts: new Set<string>() } } });
const fakeNode = (appPATH: string) => ({
  id: 7,
  module: {
    appDir: `${appPATH}qg/cms.cont.html/`,
    appUrl: "/app/qg/cms.cont.html/",
  },
});

const tmpDir = async () => await Deno.makeTempDir() + "/";
const read = (path: string) => Deno.readTextFile(path).catch(() => undefined);

Deno.test("codeFiles: source lies next to pub/, assets inside", async () => {
  const dir = await tmpDir();
  const files = codeFiles(fakeNode(dir) as any);
  assertEquals(files.src, `${dir}qg/cms.cont.html/7.html`);
  assertEquals(files.css, `${dir}qg/cms.cont.html/pub/7.css`);
  assertEquals(files.js, `${dir}qg/cms.cont.html/pub/7.js`);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("codeFiles: create writes the initial content, existing files are kept", async () => {
  const dir = await tmpDir();
  const files = codeFiles(fakeNode(dir) as any);
  await files.create("<div>first</div>");
  await files.create("<div>second</div>");
  assertEquals(await read(files.src), "<div>first</div>");
  assertEquals(await read(files.css), `/* root-elements attributes are generated at render-time: qcms-id="385" qcms-mod="cont.html" */
[qcms-id="7"] { /* nesting syntax */
}
`);
  assertEquals((await read(files.js))?.includes(`observe('[qcms-id="7"]')`), true);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("codeFiles: addAssets only links files that exist", async () => {
  const dir = await tmpDir();
  const files = codeFiles(fakeNode(dir) as any);
  await Deno.mkdir(`${dir}qg/cms.cont.html/pub/`, { recursive: true });
  await Deno.writeTextFile(files.css, "");
  const ctx = fakeCtx();
  await requestStorage.run(ctx as any, () => files.addAssets());
  assertEquals([...ctx.res.html.styles], ["/app/qg/cms.cont.html/pub/7.css"]);
  assertEquals([...ctx.res.html.scripts], []);
  await Deno.remove(dir, { recursive: true });
});
