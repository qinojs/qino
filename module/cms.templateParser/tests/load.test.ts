import { assertEquals } from "@qino/qino/tests";

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

Deno.test("loadTemplate: a local file URL is read like its path", async () => {
  const path = await Deno.makeTempFile({ suffix: " space.html" });
  await Deno.writeTextFile(path, "<div>local URL</div>");
  const url = new URL(`file://${path}`);
  assertEquals(text(await loadTemplate(url)), text(await loadTemplate(path)));
  assertEquals(text(await loadTemplate(url.href)), text(await loadTemplate(path)));
  await Deno.remove(path);
});

Deno.test("loadTemplate: a remote template is fetched once and cached", async () => {
  const real = globalThis.fetch;
  const url = `https://qino.test/${crypto.randomUUID()}/template.html`;
  let requests = 0;
  globalThis.fetch = (input: string | URL | Request) => {
    assertEquals(String(input), url);
    requests++;
    return Promise.resolve(new Response("<div>remote</div>"));
  };
  try {
    const first = await loadTemplate(url);
    assertEquals(await loadTemplate(url), first);
    assertEquals(requests, 1);
  } finally {
    globalThis.fetch = real;
  }
});
