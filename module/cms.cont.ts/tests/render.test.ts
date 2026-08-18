// deno-lint-ignore-file no-explicit-any
import { requestStorage } from "@qino/qino";
import { assertEquals, assertRejects } from "@qino/qino/tests";

import { cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };

const { name } = manifest;

const fakeCtx = () => ({ req: { appUrl: "/app/" }, res: { html: { styles: new Set<string>(), scripts: new Set<string>() } } });
const fakeModule = (dir: string) => ({ name, data: `${dir}data/${name}/`, dataUrl: `/app/d/${name}/` });
const fakeNode = (dir: string, edit: boolean) => ({ id: 7, edit, app: { dir: dir, dev: false }, module: fakeModule(dir) });

const render = (node: any, ctx: any) => requestStorage.run(ctx, () => cms.node.render(node, { ctx, vars: {} }));

async function withSource(source: string): Promise<string> {
  const dir = await Deno.makeTempDir() + "/";
  await Deno.mkdir(`${dir}data/${name}/pub/`, { recursive: true });
  await Deno.writeTextFile(`${dir}data/${name}/7.ts`, source);
  return dir;
}

Deno.test("cms.cont.ts: the default export of the file renders the node", async () => {
  const dir = await withSource("export default (node) => `<div>id ${node.id}</div>`;");
  assertEquals(await render(fakeNode(dir, false), fakeCtx()), "<div>id 7</div>");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("cms.cont.ts: html is handed to the file, so it needs no import", async () => {
  const dir = await withSource("export default (node, { html }) => html.async`<b>${'<script>'}</b>`;");
  assertEquals(await render(fakeNode(dir, false), fakeCtx()), "<b>&lt;script&gt;</b>");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("cms.cont.ts: a file without a default export is an error", async () => {
  const dir = await withSource("export const x = 1;");
  await assertRejects(() => render(fakeNode(dir, false), fakeCtx()), Error, "no default exported function");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("cms.cont.ts: without a file a visitor sees nothing", async () => {
  const dir = await Deno.makeTempDir() + "/";
  assertEquals(await render(fakeNode(dir, false), fakeCtx()), "<div></div>");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("cms.cont.ts: the first render in edit mode creates a working file", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const ctx = fakeCtx();
  assertEquals((await render(fakeNode(dir, true), ctx)).includes("Node 7"), true);
  assertEquals([...ctx.res.html.styles], [`/app/d/${name}/pub/7.css`]);
  await Deno.remove(dir, { recursive: true });
});
