// deno-lint-ignore-file no-explicit-any
import { Db, FileTransformer } from "@qino/qino";
import { aiAdapters, aiCapabilities, aiDbSchema, assertEquals } from "@qino/qino/tests";

import { init } from "../plugin.ts";

import type { App } from "@qino/qino";
import type { Adapter } from "@qino/qino/ai";

// Reads an image as fenced Markdown, hears every file as "hello".
const fake: Adapter = {
  text: (_call, { messages }) => Promise.resolve({ text: `\`\`\`markdown\n# ${messages[0].content[0].type}\n\`\`\``, toolCalls: [], truncated: false }),
  transcribe: (_call, { file }) => Promise.resolve({ kind: "qino.transcript", version: 1, text: `hello ${file.name}`, segments: [] }),
};

Deno.test("ai.transform: ai reads images and hears audio while linked", async () => {
  const dir = await Deno.makeTempDir();
  const db = new Db("sqlite::memory:");
  await db.migrate(aiDbSchema);
  await db.loadTables();
  await db.table("ai_provider").insert({ name: "fake", type: "fake", endpoint: "" });
  await db.table("ai_model").insert({ name: "m" });
  await db.table("ai_model_provider").insert({ model_id: 1, provider_id: 1 });
  const mods = [{ name: "ai", plugin: { aiAdapters: { ...aiAdapters, fake }, aiCapabilities } }];
  const app = {
    db, settings: { core: { keys: {} } }, fire: (_: string, e: unknown) => Promise.resolve(e), fileTransformer: FileTransformer.create({ cacheDir: dir }),
    modules: { linked: (name?: string) => name ? mods.find((m) => m.name === name) : mods },
  } as unknown as App;
  const unlink = new AbortController();
  init(app, { signal: unlink.signal });
  const tf = app.fileTransformer, ctx = {} as any;
  assertEquals((await tf.transcriptEngine(ctx))?.name, undefined); // no model for it yet
  for (const capability of ["text", "vision", "transcribe"]) await db.table("ai_model_capability").insert({ model_id: 1, capability });
  const file = `${dir}/a.mp3`;
  await Deno.writeFile(file, new Uint8Array([1]));
  assertEquals(await (await tf.ocrEngine(ctx))!.ocr(file, "image/png", ctx), "# image"); // the fence goes
  assertEquals((await (await tf.transcriptEngine(ctx))!.transcribe(file, "audio/mpeg", ctx)).text, "hello a.mp3");
  unlink.abort();
  assertEquals((await tf.transcriptEngine(ctx))?.name, undefined);
  assertEquals((await tf.ocrEngine(ctx))?.name === "ai", false);
  await db.close();
  await Deno.remove(dir, { recursive: true });
});
