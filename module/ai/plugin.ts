import dbSchema from "./dbschema.json" with { type: "json" };
import { AiApi, aiInstances } from "./lib/AiApi.ts";
import type { App } from "../core/mod.ts";
import { registerAiOcr } from "./lib/ocr.ts";
import { registerAiTranscript } from "./lib/transcript.ts";

export const name = "ai";
export const description = "Provides configurable AI providers, chat sessions, OCR, and transcription.";
export const needs = ["core"];
export { api } from "./api.ts";
export { dbSchema };

export function init(app: App) {
  aiInstances.set(app, new AiApi(app));
  registerAiOcr(app); // AI-vision OCR engine
  registerAiTranscript(app); // AI speech-to-text engine
}
