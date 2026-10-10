import * as nodePath from "node:path";
import { fs } from "@qino/qino";
import { candidates, ocr, transcribe } from "@qino/qino/ai";

import type { App } from "@qino/qino";

// ai as OCR and transcription engine of the core's file transforms, ahead of Tesseract.

/** ai has a model for `capability` with every one of `needs`. */
const serves = async (app: App, capability: string, needs?: string[]) => (await candidates(app, capability, {}, { needs })).length > 0;

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.fileTransformer.registerOcrEngine({
    name: "ai",
    priority: 10,
    beatsTextLayer: true,
    // an OCR model, else any that sees (ocr via text)
    available: async () => await serves(app, "ocr") || serves(app, "text", ["vision"]),
    ocr: async (path, mime) => ocr(app, { image: `data:${mime};base64,${(await fs.bytes(path)).toBase64()}` }),
  }, { signal });
  app.fileTransformer.registerTranscriptEngine({
    name: "ai",
    priority: 10,
    available: () => serves(app, "transcribe"),
    // the provider tells the format by the file's extension
    transcribe: async (path, mime) =>
      transcribe(app, { file: new File([await fs.bytes(path)], nodePath.extname(path) ? nodePath.basename(path) : `audio.${mime.split("/")[1]}`, { type: mime }) }),
  }, { signal });
}
