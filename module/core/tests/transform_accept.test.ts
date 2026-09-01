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
    await Deno.writeTextFile(out, avif ? "avif" : "jpeg");
    ctx.currentPath = out;
    ctx.mime = avif ? "image/avif" : "image/jpeg";
  },
};

Deno.test("FileTransformer: Accept decides the format and is part of the cache key", async (t) => {
  const dir = await Deno.makeTempDir();
  const src = dir + "/src.bin";
  await Deno.writeFile(src, new Uint8Array([1, 2, 3]));
  const tf = new FileTransformer({ cacheDir: dir + "/cache" });
  tf.register(encode);
  const run = (accept?: string) => tf.transform(src, {}, "image/jpeg", accept);

  try {
    await t.step("a client that lists avif gets it", async () => {
      assertEquals((await run("image/avif,image/webp,*/*;q=0.8")).mime, "image/avif");
    });

    await t.step("an old Safari without avif gets the fallback, not the cached avif", async () => {
      assertEquals((await run("image/webp,image/png,*/*;q=0.8")).mime, "image/jpeg");
    });

    await t.step("image/* and */* are no evidence of avif support", async () => {
      assertEquals((await run("image/*,*/*")).mime, "image/jpeg");
    });

    await t.step("no header is no constraint, and shares the key with an avif client", async () => {
      assertEquals((await run(undefined)).mime, "image/avif");
      assertEquals((await run(undefined)).key, (await run("image/avif")).key);
    });

    await t.step("an explicit fmt is not negotiated — same key whatever the client sends", async () => {
      const a = await tf.transform(src, { fmt: "png" }, "image/jpeg", "image/avif");
      const b = await tf.transform(src, { fmt: "png" }, "image/jpeg", "image/webp");
      assertEquals(a.key, b.key);
    });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
