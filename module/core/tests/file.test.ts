import { assertEquals } from "./deps.ts";
import { File } from "../lib/File.ts";

Deno.test("File: contents read/write, basename, size and md5", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const path = dir + "/hello.txt";
    const file = new File(path);

    assertEquals(await file.exists(), false);
    assertEquals(await file.contents("hello"), 5);
    assertEquals(await file.exists(), file);
    assertEquals(await file.contents(), "hello");
    assertEquals(file.basename(), "hello.txt");
    assertEquals(file.basename(".txt"), "hello");
    assertEquals(await file.size(), 5);
    assertEquals(await file.md5(), "5d41402abc4b2a76b9719d911017c592");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("File: copyTo and getText handle common text/html files", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const txt = new File(dir + "/a.txt");
    const html = new File(dir + "/b.html");
    const bin = new File(dir + "/c.bin");

    await txt.contents("plain");
    await html.contents("<h1>Hello</h1><p>World</p>");
    await bin.contents(new Uint8Array([1, 2, 3]));

    assertEquals(await txt.copyTo(dir + "/copy.txt"), true);
    assertEquals(await new File(dir + "/copy.txt").contents(), "plain");
    assertEquals(await txt.getText(), "plain");
    assertEquals(await html.getText(), "HelloWorld");
    assertEquals(await bin.getText(), "");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("File: empty and spaced filenames keep stable metadata", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const empty = new File(dir + "/empty file.txt");
    const same = new File(dir + "/same content.txt");
    await empty.contents("");
    await same.contents("");

    assertEquals(empty.basename(), "empty file.txt");
    assertEquals(empty.basename(".html"), "empty file.txt");
    assertEquals(await empty.size(), 0);
    assertEquals(await empty.md5(), "d41d8cd98f00b204e9800998ecf8427e");
    assertEquals(await same.md5(), await empty.md5());
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("File: missing files return safe defaults", async () => {
  const file = new File("/tmp/qino-missing-file-" + crypto.randomUUID());
  assertEquals(await file.exists(), false);
  assertEquals(await file.mtime(), false);
  assertEquals(await file.size(), 0);
  assertEquals(await file.md5(), "");
  assertEquals(await file.getText(), "");
  assertEquals(file.extension, file.path.toLowerCase());
  assertEquals(file.mime, "application/octet-stream");
});
