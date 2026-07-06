import type { App } from "../../core/mod.ts";
import type {} from "../mod.ts"; // App.ai augmentation
import { resolve } from "./registry.ts";

// AI-vision OCR engine: transcribes document images to Markdown via a configured
// "vision" model. Registered per app on its FileTransformer.

const PROMPT =
  "Transcribe this document image to Markdown. Reproduce the content faithfully and completely, " +
  "including headings, lists and tables. Output only the Markdown content — no code fences, no commentary.";

/** True if the app has a vision model and a provider key configured */
async function hasVisionModel(app: App): Promise<boolean> {
  if (!app.ai) return false;
  try {
    const { provider, model } = await resolve(app, { kind: "vision" });
    if (!model) return false;
    await app.ai.client(provider); // throws if no API key configured
    return true;
  } catch { return false; }
}

export function registerAiOcr(app: App): void {
  app.fileTransformer.registerOcrEngine({
    name: "ai-vision",
    priority: 10,
    beatsTextLayer: true,
    available: () => hasVisionModel(app),
    ocr: async (imagePath, mime) => {
      const image = (await Deno.readFile(imagePath)).toBase64();
      const res = await app.ai.vision({
        messages: [{
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mime};base64,${image}` } },
            { type: "text", text: PROMPT },
          ],
        }],
        temperature: 0,
        max_tokens: 16000,
      }) as { error?: unknown; choices?: { message?: { content?: string } }[] };
      const err = res.error;
      if (err) throw new Error(`AI OCR: ${typeof err === "object" ? (err as { message?: string }).message ?? JSON.stringify(err) : err}`);
      const text = (res.choices?.[0]?.message?.content ?? "").trim();
      return text.replace(/^```(?:markdown)?\s*\n([\s\S]*)\n```$/, "$1");
    },
  });
}
