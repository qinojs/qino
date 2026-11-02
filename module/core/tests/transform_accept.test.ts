import { test } from "node:test";
import { fs } from "../lib/fs.ts";
import { assertEquals } from "./deps.ts";
import { FileTransformer } from "../lib/transform/FileTransformer.ts";

import type { TransformerDef } from "../lib/transform/types.ts";

// Writes the format it would send, so the test reads the decision instead of guessing at bytes.
const encode: TransformerDef = {
  name: "encode",
  phase: "encode",
  props: ["fmt"],
  handles: () => true,
  transform: async (ctx) => {
    const avif = !ctx.accept || ctx.accept.includes("image/avif");
    const out = ctx.tmpDir + "/out";
    await fs.write(out, avif ? "avif" : "jpeg");
    ctx.currentPath = out;
    ctx.mime = avif ? "image/avif" : "image/jpeg";
  },
};

test("FileTransformer: Accept decides the format and is part of the cache key", async (t) => {
  const dir = await fs.tempDir();
  const src = dir + "/src.bin";
  await fs.write(src, new Uint8Array([1, 2, 3]));
  const tf = new FileTransformer({ cacheDir: dir + "/cache" });
  tf.register(encode);
  const run = (accept?: string) => tf.transform(src, {}, "image/jpeg", accept);

  try {
    await t.test("a client that lists avif gets it", async () => {
      assertEquals((await run("image/avif,image/webp,*/*;q=0.8")).mime, "image/avif");
    });

    await t.test("an old Safari without avif gets the fallback, not the cached avif", async () => {
      assertEquals((await run("image/webp,image/png,*/*;q=0.8")).mime, "image/jpeg");
    });

    await t.test("image/* and */* are no evidence of avif support", async () => {
      assertEquals((await run("image/*,*/*")).mime, "image/jpeg");
    });

    await t.test("no header is no constraint, and shares the key with an avif client", async () => {
      assertEquals((await run(undefined)).mime, "image/avif");
      assertEquals((await run(undefined)).key, (await run("image/avif")).key);
    });

    await t.test("an explicit fmt is not negotiated — same key whatever the client sends", async () => {
      const a = await tf.transform(src, { fmt: "png" }, "image/jpeg", "image/avif");
      const b = await tf.transform(src, { fmt: "png" }, "image/jpeg", "image/webp");
      assertEquals(a.key, b.key);
    });
  } finally {
    await fs.remove(dir, { recursive: true });
  }
});
