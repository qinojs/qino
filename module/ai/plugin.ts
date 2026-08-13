import dbSchema from "./dbschema.json" with { type: "json" };
import { AiApi, aiInstances } from "./lib/AiApi.ts";
import type { App } from "@qino/qino";
import { registerAiOcr } from "./lib/ocr.ts";
import { registerAiTranscript } from "./lib/transcript.ts";

export { api } from "./api.ts";
export { dbSchema };

export function init(app: App) {
  aiInstances.set(app, new AiApi(app));
  registerAiOcr(app); // AI-vision OCR engine
  registerAiTranscript(app); // AI speech-to-text engine
}
