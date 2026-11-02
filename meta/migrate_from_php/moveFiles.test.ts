import { test } from "node:test";
import { fs } from "@qino/qino";
import { assertEquals } from "@qino/qino/tests";

import { dirNames, moveMerge } from "./moveFiles.ts";

const read = (path: string) => fs.text(path).catch(() => null);

test("moveMerge: moves a legacy tree and leaves nothing behind", async () => {
  const dir = await fs.tempDir() + "/";
  await fs.mkdir(dir + "qg/file");
  await fs.mkdir(dir + "qg/cms.cont.html/pub");
  await fs.write(dir + "qg/file/abc123", "upload");
  await fs.write(dir + "qg/cms.cont.html/7.html", "<div>");
  await fs.write(dir + "qg/cms.cont.html/pub/7.css", "div{}");

  assertEquals(await dirNames(dir + "qg/"), ["cms.cont.html", "file"]);
  assertEquals(await moveMerge(dir + "qg/file/", dir + "data/core/file/"), [1, 0]);
  assertEquals(await moveMerge(dir + "qg/cms.cont.html/", dir + "data/cms.cont.html/"), [2, 0]);

  assertEquals(await read(dir + "data/core/file/abc123"), "upload");
  assertEquals(await read(dir + "data/cms.cont.html/7.html"), "<div>");
  assertEquals(await read(dir + "data/cms.cont.html/pub/7.css"), "div{}");
  assertEquals(await dirNames(dir + "qg/"), []); // sources removed once empty
  await fs.remove(dir, { recursive: true });
});

test("moveMerge: an existing target is kept, its source survives", async () => {
  const dir = await fs.tempDir() + "/";
  await fs.mkdir(dir + "qg/file");
  await fs.mkdir(dir + "data/core/file");
  await fs.write(dir + "qg/file/abc123", "old");
  await fs.write(dir + "qg/file/def456", "moves");
  await fs.write(dir + "data/core/file/abc123", "current");

  assertEquals(await moveMerge(dir + "qg/file/", dir + "data/core/file/"), [1, 1]);
  assertEquals(await read(dir + "data/core/file/abc123"), "current"); // never overwritten
  assertEquals(await read(dir + "data/core/file/def456"), "moves");
  assertEquals(await read(dir + "qg/file/abc123"), "old"); // conflict stays put
  await fs.remove(dir, { recursive: true });
});

test("moveMerge: a second run is a no-op, dirNames ignores a missing dir", async () => {
  const dir = await fs.tempDir() + "/";
  await fs.mkdir(dir + "qg/file");
  await fs.write(dir + "qg/file/abc123", "upload");

  assertEquals(await moveMerge(dir + "qg/file/", dir + "data/core/file/"), [1, 0]);
  assertEquals(await moveMerge(dir + "qg/file/", dir + "data/core/file/"), [0, 0]);
  assertEquals(await read(dir + "data/core/file/abc123"), "upload");
  assertEquals(await dirNames(dir + "nothing/"), []);
  await fs.remove(dir, { recursive: true });
});
