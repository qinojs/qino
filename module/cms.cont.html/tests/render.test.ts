// deno-lint-ignore-file no-explicit-any
import { assertEquals, assertStringIncludes } from "../../core/tests/deps.ts";
import { requestStorage } from "../../core/mod.ts";
import { cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };
const { name } = manifest;

const fakeCtx = () => ({ req: { appUrl: "/app/" }, res: { html: { styles: new Set<string>(), scripts: new Set<string>() } } });

function fakeNode(dir: string, edit: boolean) {
  return {
    id: 7,
    edit,
    app: { appPATH: dir, dev: false },
    module: { name, data: `${dir}data/${name}/`, dataUrl: `/app/d/${name}/` },
    cms: { text: (_n: any, part: string) => `<p>${part}</p>` },
  };
}

const render = (node: any, ctx: any) => requestStorage.run(ctx, () => cms.node.render(node));

Deno.test("cms.cont.html: renders the file of the node, unknown to the parser stays as written", async () => {
  const dir = await Deno.makeTempDir() + "/";
  await Deno.mkdir(`${dir}data/${name}/pub/`, { recursive: true });
  await Deno.writeTextFile(`${dir}data/${name}/7.html`, "<div><script>if (a < b) x();</script></div>");
  await Deno.writeTextFile(`${dir}data/${name}/pub/7.js`, "");

  const ctx = fakeCtx();
  assertEquals(await render(fakeNode(dir, false), ctx), "<div><script>if (a < b) x();</script></div>");
  assertEquals([...ctx.res.html.scripts], [`/app/d/${name}/pub/7.js`]);
  assertEquals([...ctx.res.html.styles], []); // no css file
  await Deno.remove(dir, { recursive: true });
});

Deno.test("cms.cont.html: the first render in edit mode creates the files, the example stays commented out", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const ctx = fakeCtx();
  const out = await render(fakeNode(dir, true), ctx);
  assertStringIncludes(out, "<div>");
  assertEquals(out.includes("cms-text"), false); // examples are comments, nothing is created
  const source = await Deno.readTextFile(`${dir}data/${name}/7.html`);
  assertStringIncludes(source, "<!-- editable text");
  assertStringIncludes(source, "cms-link=page");
  assertEquals([...ctx.res.html.styles], [`/app/d/${name}/pub/7.css`]);
  assertEquals([...ctx.res.html.scripts], [`/app/d/${name}/pub/7.js`]);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("cms.cont.html: without a file a visitor sees nothing", async () => {
  const dir = await Deno.makeTempDir() + "/";
  assertEquals(await render(fakeNode(dir, false), fakeCtx()), "<div></div>");
  await Deno.remove(dir, { recursive: true });
});
