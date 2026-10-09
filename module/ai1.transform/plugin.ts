import * as nodePath from "node:path";
import { fs } from "@qino/qino";
import { candidates, text, transcribe } from "@qino/qino/ai1";

import type { App } from "@qino/qino";

// ai1 as OCR and transcription engine of the core's file transforms, ahead of Tesseract.

const PROMPT = "Transcribe this document image to Markdown. Reproduce the content faithfully and completely, " +
  "including headings, lists and tables. Output only the Markdown content — no code fences, no commentary.";

/** ai1 has a model for `capability` with every one of `needs`. */
const serves = async (app: App, capability: string, needs?: string[]) => (await candidates(app, capability, {}, { needs })).length > 0;

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.fileTransformer.registerOcrEngine({
    name: "ai1",
    priority: 10,
    beatsTextLayer: true,
    available: () => serves(app, "text", ["vision"]),
    ocr: async (path, mime) => {
      const url = `data:${mime};base64,${(await fs.bytes(path)).toBase64()}`;
      const { text: md } = await text(app, { messages: [{ role: "user", content: [{ type: "image", url }, { type: "text", text: PROMPT }] }], temperature: 0, maxTokens: 16000 });
      return md.trim().replace(/^```(?:markdown)?\s*\n([\s\S]*)\n```$/, "$1");
    },
  }, { signal });
  app.fileTransformer.registerTranscriptEngine({
    name: "ai1",
    priority: 10,
    available: () => serves(app, "transcribe"),
    // the provider tells the format by the file's extension
    transcribe: async (path, mime) =>
      transcribe(app, { file: new File([await fs.bytes(path)], nodePath.extname(path) ? nodePath.basename(path) : `audio.${mime.split("/")[1]}`, { type: mime }) }),
  }, { signal });
}
