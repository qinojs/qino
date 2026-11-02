import { test } from "node:test";
import { fs } from "../lib/fs.ts";
import { assertEquals } from "./deps.ts";
import { FileTransformer } from "../lib/transform/FileTransformer.ts";
import { markdown } from "../lib/transform/transformers/markdown.ts";
import { transcript, TRANSCRIPT_MIME } from "../lib/transform/transformers/transcript.ts";

test("FileTransformer: transcript JSON and Markdown", async () => {
  const dir = await fs.tempDir();
  try {
    const src = dir + "/talk.mp3";
    await fs.write(src, new Uint8Array([1, 2, 3]));
    const transformer = new FileTransformer({ cacheDir: dir + "/cache" });
    transformer.register(transcript);
    transformer.register(markdown);
    transformer.registerTranscriptEngine({
      name: "test-stt",
      priority: 1,
      available: () => true,
      transcribe: async () => ({
        kind: "qino.transcript",
        version: 1,
        text: "Hallo und willkommen.",
        language: "de",
        segments: [{ start: 1.2, end: 3.4, text: "Hallo und willkommen.", notes: ["lachen"] }],
      }),
    });

    const json = await transformer.transform(src, { fmt: "json" }, "audio/mpeg");
    assertEquals(json.mime, TRANSCRIPT_MIME);
    assertEquals(JSON.parse(await fs.text(json.path)).segments[0].notes, ["lachen"]);

    const md = await transformer.transform(src, { fmt: "md" }, "audio/mpeg");
    assertEquals(md.mime, "text/markdown");
    assertEquals(await fs.text(md.path), "Hallo und willkommen.\n\n(lachen)\n");
  } finally {
    await fs.remove(dir, { recursive: true });
  }
});

test("FileTransformer: transcript request errors without engine", async () => {
  const dir = await fs.tempDir();
  try {
    const src = dir + "/talk.mp3";
    await fs.write(src, new Uint8Array([1, 2, 3]));
    const transformer = new FileTransformer({ cacheDir: dir + "/cache" });
    transformer.register(transcript);

    const result = await transformer.transform(src, { fmt: "md" }, "audio/mpeg");
    assertEquals(result.transformed, false);
    assertEquals(result.error?.message, "transcript: no speech-to-text engine available");
  } finally {
    await fs.remove(dir, { recursive: true });
  }
});
