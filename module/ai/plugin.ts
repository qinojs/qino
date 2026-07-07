import dbSchema from "./dbschema.json" with { type: "json" };
import { AiApi } from "./mod.ts";
import type { App } from "../core/mod.ts";
import { registerAiOcr } from "./lib/ocr.ts";
import { registerAiTranscript } from "./lib/transcript.ts";

export const name = "ai";
export const needs = ["core"];
export { api } from "./apt.ts";
export { dbSchema };

export function init(app: Pick<App, "aptTree" | "on" | "settings" | "fileTransformer"> & { ai?: AiApi }) {
  app.ai = new AiApi(app as App);
  registerAiOcr(app as App); // AI-vision OCR engine
  registerAiTranscript(app as App); // AI speech-to-text engine
}
