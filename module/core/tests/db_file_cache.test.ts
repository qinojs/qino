import { DbFile } from "../mod.ts";
import { assertEquals, DbFileManager } from "./deps.ts";

/** A manager over one row the test can change behind its back, plus a read counter. */
function fixture(dir: string) {
  const row: Record<string, unknown> = { id: 3, name: "a.txt", md5: "aaa" };
  const reads = { count: 0 };
  const app = { db: { row: () => { reads.count++; return Promise.resolve({ ...row }); } } };
  return { row, reads, files: new DbFileManager(app as never, dir) };
}

Deno.test("DbFile: a cached object is never rewritten by a preloaded row", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const { reads, files } = fixture(dir);
    const file = await files.file(3);
    assertEquals([file.name, reads.count], ["a.txt", 1]);

    const again = await files.file(3, { id: 3, name: "historical.txt", md5: "bbb" });
    assertEquals(again === file, true);
    assertEquals([file.name, file.path, reads.count], ["a.txt", dir + "/aaa", 1]);

    // A row handed to a fresh object preloads it, so no query follows.
    const other = await files.file(4, { id: 4, name: "b.txt", md5: "ccc" });
    assertEquals([other.name, reads.count], ["b.txt", 1]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("DbFile: reload picks up a write that went past the manager", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const { row, reads, files } = fixture(dir);
    const file = await files.file(3);

    row.name = "restored.txt";
    row.md5 = "ddd";
    assertEquals(await file.reload() === file, true);
    assertEquals([file.name, file.path, reads.count], ["restored.txt", dir + "/ddd", 2]);

    // Losing the md5 loses the path: the row no longer points at a file.
    delete row.md5;
    await file.reload();
    assertEquals(file.path, "");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("DbFile: a row passed to the constructor is a detached view", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const { files } = fixture(dir);
    const live = await files.file(3);
    const historical = new DbFile(files, 3, { id: 3, name: "old.txt", md5: "eee" });

    assertEquals([historical.name, historical.path], ["old.txt", dir + "/eee"]);
    assertEquals([live.name, live.path], ["a.txt", dir + "/aaa"]);
    assertEquals(await files.file(3) === live, true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
