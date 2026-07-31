import { assertEquals } from "../../core/tests/deps.ts";
import { loadTemplate } from "../mod.ts";

const text = (ast: unknown) => JSON.stringify(ast);

Deno.test("loadTemplate: no file, no template", async () => {
  assertEquals(await loadTemplate("/tmp/qino-does-not-exist.html"), undefined);
});

Deno.test("loadTemplate: a saved file is reparsed, an unchanged one comes from the cache", async () => {
  const path = await Deno.makeTempFile({ suffix: ".html" });
  await Deno.writeTextFile(path, "<div>a</div>");
  const first = await loadTemplate(path);
  assertEquals(await loadTemplate(path), first); // same object — parsed once

  await new Promise((r) => setTimeout(r, 10)); // let mtime advance
  await Deno.writeTextFile(path, "<div>b</div>");
  const second = await loadTemplate(path);
  assertEquals(text(second) === text(first), false);
  await Deno.remove(path);
});
