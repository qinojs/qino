import { assertEquals } from "./deps.ts";
import { FileTransformer } from "../lib/transform/FileTransformer.ts";

Deno.test("FileTransformer: identical requests share work; other keys and instances stay independent", async () => {
  const dir = await Deno.makeTempDir();
  const gate = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  let runs = 0;
  const build = (cacheDir: string) => {
    const tf = new FileTransformer({ cacheDir });
    tf.register({
      name: "stamp", phase: "encode", props: ["w"], handles: () => true,
      transform: async (ctx) => {
        if (++runs === 3) started.resolve();
        await gate.promise;
        ctx.currentPath = ctx.tmpDir + "/out";
        await Deno.writeTextFile(ctx.currentPath, String(ctx.options.w));
      },
    });
    return tf;
  };
  try {
    const src = dir + "/src";
    await Deno.writeTextFile(src, "source");
    const a = build(dir + "/a"), b = build(dir + "/b");
    const requests = [a.transform(src, { w: 1 }), a.transform(src, { w: 1 }), a.transform(src, { w: 2 }), b.transform(src, { w: 1 })];
    await started.promise;
    gate.resolve();
    const results = await Promise.all(requests);
    assertEquals(runs, 3);
    assertEquals(results[0], results[1]);
    assertEquals(await Deno.readTextFile(results[2].path), "2");
    await a.transform(src, { w: 1 });
    assertEquals(runs, 3);
  } finally {
    gate.resolve();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FileTransformer: failed work is released for retry", async () => {
  const dir = await Deno.makeTempDir();
  const tf = new FileTransformer({ cacheDir: dir + "/cache" });
  let runs = 0;
  tf.register({
    name: "retry", phase: "encode", props: [], handles: () => true,
    transform: async (ctx) => {
      if (++runs === 1) throw new Error("expected transform failure");
      ctx.currentPath = ctx.tmpDir + "/out";
      await Deno.writeTextFile(ctx.currentPath, "ok");
    },
  });
  try {
    const src = dir + "/src";
    await Deno.writeTextFile(src, "source");
    assertEquals((await tf.transform(src, {})).error?.message, "expected transform failure");
    const result = await tf.transform(src, {});
    assertEquals(result.transformed, true);
    assertEquals(runs, 2);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
