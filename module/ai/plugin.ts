import dbSchema from "./dbschema.json" with { type: "json" };
import { AiApi } from "./mod.ts";
import type { App } from "../core/mod.ts";
import "./lib/ocr.ts"; // registers the AI-vision OCR engine

export const name = "ai";
export const needs = ["core"];
export { api } from "./apt.ts";
export { dbSchema };

export function init(app: Pick<App, "aptTree" | "on" | "settings"> & { ai?: AiApi }) {
  app.ai = new AiApi(app as App);
}
