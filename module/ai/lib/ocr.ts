import { registerOcrEngine, type TransformContext } from "../../core/mod.ts";
import type {} from "../mod.ts"; // App.ai augmentation
import { resolve } from "./registry.ts";

// AI-vision OCR engine: transcribes document images to Markdown via a configured
// "vision" model. Registered once per runtime; the tenant App arrives via ctx.app.

const PROMPT =
  "Transcribe this document image to Markdown. Reproduce the content faithfully and completely, " +
  "including headings, lists and tables. Output only the Markdown content — no code fences, no commentary.";

/** True if the app has a vision model and a provider key configured */
async function hasVisionModel(ctx: TransformContext): Promise<boolean> {
  if (!ctx.app?.ai) return false;
  try {
    const { provider, model } = await resolve(ctx.app, { kind: "vision" });
    if (!model) return false;
    await ctx.app.ai.client(provider); // throws if no API key configured
    return true;
  } catch { return false; }
}

registerOcrEngine({
  name: "ai-vision",
  priority: 10,
  beatsTextLayer: true,
  available: hasVisionModel,
  ocr: async (imagePath, mime, ctx) => {
    const image = (await Deno.readFile(imagePath)).toBase64();
    const res = await ctx.app!.ai.vision({
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
