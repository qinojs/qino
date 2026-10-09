import { assertEquals } from "@qino/qino/tests";

import { create, indexFile, indexFiles, search } from "../mod.ts";
import { init } from "../plugin.ts";
import fileSchema from "../sources/file.json" with { type: "json" };
import { fakeApp } from "./fake.ts";

import type { App } from "@qino/qino";

const all = { file_text: true, file_image: true } as const;
const hits = async (app: App) => (await search(app, all, "cat", { limit: 20 })).map((h) => `${h.name}/${h.key.file_id}`).sort();

Deno.test("ai1.embed: indexes files, catches up on missing ones only", async () => {
  const dir = await Deno.makeTempDir();
  const file = { additionalProperties: { properties: { id: { type: "integer", "x-index": "primary" }, text: { type: "string" }, mime: { type: "string" }, md5: { type: "string" } } } };
  const { app, db, calls, settings } = await fakeApp("sqlite::memory:", { file, ...fileSchema.properties });
  try {
    await db.exec`INSERT INTO file VALUES (7, 'cat picture', 'image/png', ${"a".repeat(32)}), (8, NULL, 'image/png', ${"b".repeat(32)}), (9, '', 'application/zip', ${"c".repeat(32)})`;
    await Deno.writeFile(`${dir}/image.png`, new Uint8Array([1]));
    const extracted: number[] = [];
    Object.assign(app, { dbFiles: { file: (id: number) => Promise.resolve({
      exists: () => Promise.resolve(true), path: `${dir}/image.png`, mime: "image/png",
      extractText: () => (extracted.push(id), db.exec`UPDATE file SET text = '' WHERE id = ${id}`.then(() => "")),
    }) } });
    await create(app, "multi", 2);

    assertEquals(await indexFiles(app), { files: 2, errors: [] }); // 9 has no text and is no image
    assertEquals(await hits(app), ["file_image/7", "file_image/8", "file_text/7"]);
    assertEquals(extracted, [8]);
    const embedded = calls.length;
    assertEquals(await indexFiles(app), { files: 0, errors: [] }); // nothing missing, not even 8 without text
    assertEquals(calls.length, embedded);

    await db.exec`UPDATE file SET mime = ${"application/pdf"} WHERE id = ${8}`;
    await indexFile(app, 8);
    assertEquals(await hits(app), ["file_image/7", "file_text/7"]); // no image any more

    // with `files` on, a changed file is indexed in the background
    const stop = new AbortController();
    Object.assign(settings, { files: true });
    init(app, { signal: stop.signal });
    await db.table("file").update(8, { mime: "image/png", md5: "d".repeat(32) });
    await new Promise((resolve) => setTimeout(resolve, 50));
    stop.abort();
    assertEquals(await hits(app), ["file_image/7", "file_image/8", "file_text/7"]);
  } finally {
    await db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
