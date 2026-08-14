import { AiApi, aiInstances } from "./lib/AiApi.ts";
import { registerAiOcr } from "./lib/ocr.ts";
import { registerAiTranscript } from "./lib/transcript.ts";

import type { App } from "@qino/qino";

export { api } from "./api.ts";
export { default as dbSchema } from "./dbschema.json" with { type: "json" };

export function init(app: App) {
  aiInstances.set(app, new AiApi(app));
  registerAiOcr(app); // AI-vision OCR engine
  registerAiTranscript(app); // AI speech-to-text engine
}
