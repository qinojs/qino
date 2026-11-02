import { test } from "node:test";
import { fs } from "../lib/fs.ts";
import { assertEquals } from "./deps.ts";
import { FileTransformer } from "../lib/transform/FileTransformer.ts";

import type { TransformerDef, TranscriptEngine } from "../lib/transform/types.ts";

/** Marks the file so a cache hit is distinguishable from a fresh run. */
const stamp: TransformerDef = {
  name: "stamp",
  phase: "encode",
  props: [],
  handles: () => true,
  transform: async (ctx) => {
    const out = ctx.tmpDir + "/out.bin";
    await fs.write(out, "x");
    ctx.currentPath = out;
  },
};

const engine = (name: string, priority: number): TranscriptEngine => ({
  name,
  priority,
  available: () => true,
  transcribe: () => Promise.resolve({ kind: "qino.transcript", version: 1, text: "", segments: [] }),
});

async function keyOf(dir: string, build: (t: FileTransformer) => void) {
  const t = new FileTransformer({ cacheDir: dir + "/cache" });
  t.register(stamp);
  build(t);
  return (await t.transform(dir + "/src.bin", {})).key!;
}

test("FileTransformer: the toolchain is part of the cache key", async (t) => {
  const dir = await fs.tempDir();
  await fs.write(dir + "/src.bin", new Uint8Array([1, 2, 3]));
  try {
    await t.test("same toolchain, same key — the cache still works", async () => {
      assertEquals(await keyOf(dir, () => {}), await keyOf(dir, () => {}));
    });

    await t.test("a registered engine changes the key", async () => {
      const plain = await keyOf(dir, () => {});
      const withEngine = await keyOf(dir, (tf) => tf.registerTranscriptEngine(engine("stt", 1)));
      assertEquals(plain === withEngine, false);
    });

    await t.test("engine priority is part of it — a higher one takes over and rewrites output", async () => {
      const low = await keyOf(dir, (tf) => tf.registerTranscriptEngine(engine("stt", 1)));
      const high = await keyOf(dir, (tf) => tf.registerTranscriptEngine(engine("stt", 9)));
      assertEquals(low === high, false);
    });
  } finally {
    await fs.remove(dir, { recursive: true });
  }
});
