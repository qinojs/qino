import { assertEquals } from "../../module/core/tests/deps.ts";
import { dirNames, moveMerge } from "./moveFiles.ts";

const read = (path: string) => Deno.readTextFile(path).catch(() => null);

Deno.test("moveMerge: moves a legacy tree and leaves nothing behind", async () => {
  const dir = await Deno.makeTempDir() + "/";
  await Deno.mkdir(dir + "qg/file", { recursive: true });
  await Deno.mkdir(dir + "qg/cms.cont.html/pub", { recursive: true });
  await Deno.writeTextFile(dir + "qg/file/abc123", "upload");
  await Deno.writeTextFile(dir + "qg/cms.cont.html/7.html", "<div>");
  await Deno.writeTextFile(dir + "qg/cms.cont.html/pub/7.css", "div{}");

  assertEquals(await dirNames(dir + "qg/"), ["cms.cont.html", "file"]);
  assertEquals(await moveMerge(dir + "qg/file/", dir + "data/core/file/"), [1, 0]);
  assertEquals(await moveMerge(dir + "qg/cms.cont.html/", dir + "data/cms.cont.html/"), [2, 0]);

  assertEquals(await read(dir + "data/core/file/abc123"), "upload");
  assertEquals(await read(dir + "data/cms.cont.html/7.html"), "<div>");
  assertEquals(await read(dir + "data/cms.cont.html/pub/7.css"), "div{}");
  assertEquals(await dirNames(dir + "qg/"), []); // sources removed once empty
  await Deno.remove(dir, { recursive: true });
});

Deno.test("moveMerge: an existing target is kept, its source survives", async () => {
  const dir = await Deno.makeTempDir() + "/";
  await Deno.mkdir(dir + "qg/file", { recursive: true });
  await Deno.mkdir(dir + "data/core/file", { recursive: true });
  await Deno.writeTextFile(dir + "qg/file/abc123", "old");
  await Deno.writeTextFile(dir + "qg/file/def456", "moves");
  await Deno.writeTextFile(dir + "data/core/file/abc123", "current");

  assertEquals(await moveMerge(dir + "qg/file/", dir + "data/core/file/"), [1, 1]);
  assertEquals(await read(dir + "data/core/file/abc123"), "current"); // never overwritten
  assertEquals(await read(dir + "data/core/file/def456"), "moves");
  assertEquals(await read(dir + "qg/file/abc123"), "old"); // conflict stays put
  await Deno.remove(dir, { recursive: true });
});

Deno.test("moveMerge: a second run is a no-op, dirNames ignores a missing dir", async () => {
  const dir = await Deno.makeTempDir() + "/";
  await Deno.mkdir(dir + "qg/file", { recursive: true });
  await Deno.writeTextFile(dir + "qg/file/abc123", "upload");

  assertEquals(await moveMerge(dir + "qg/file/", dir + "data/core/file/"), [1, 0]);
  assertEquals(await moveMerge(dir + "qg/file/", dir + "data/core/file/"), [0, 0]);
  assertEquals(await read(dir + "data/core/file/abc123"), "upload");
  assertEquals(await dirNames(dir + "nothing/"), []);
  await Deno.remove(dir, { recursive: true });
});
