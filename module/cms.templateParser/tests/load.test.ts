import { assert, assertEquals } from "@qino/qino/tests";
import { fs } from "@qino/qino";

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
  await fs.write(path, "<div>b</div>"); // through fs, or the cached stat hides it until its ttl
  const second = await loadTemplate(path);
  assert(text(second) !== text(first));
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

Deno.test("loadTemplate: changed content with the same timestamp is reparsed", async () => {
  const path = await Deno.makeTempFile({ suffix: ".html" });
  try {
    await Deno.writeTextFile(path, "<div>a</div>");
    const time = new Date("2020-01-01T00:00:00Z");
    await Deno.utime(path, time, time);
    const first = await loadTemplate(path);
    await fs.write(path, "<div>b</div>");
    await Deno.utime(path, time, time);
    assertEquals((await Deno.stat(path)).mtime, time);
    const second = await loadTemplate(path);
    assert(text(second) !== text(first));
    assert(await loadTemplate(path) === second);
    await fs.remove(path);
    assertEquals(await loadTemplate(path), undefined);
  } finally {
    await Deno.remove(path).catch(() => {});
  }
});

Deno.test("loadTemplate: cached files are not read again until fs invalidates their stat", async () => {
  const path = await Deno.makeTempFile({ suffix: ".html" });
  const read = fs.text;
  let reads = 0;
  fs.text = (file: string) => {
    if (file === path) reads++;
    return read(file);
  };
  try {
    await fs.write(path, "<div>cached</div>");
    const first = await loadTemplate(path);
    for (let i = 0; i < 100; i++) assert(await loadTemplate(path) === first);
    assertEquals(reads, 1);
    await fs.write(path, "<div>cached</div>");
    assert(await loadTemplate(path) === first);
    assertEquals(reads, 2);
    assert(await loadTemplate(path) === first);
    assertEquals(reads, 2);
  } finally {
    fs.text = read;
    await fs.remove(path);
  }
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
