// deno-lint-ignore-file no-explicit-any
import type { AptTree } from "../core/lib/apt.ts";
import { s } from "../core/lib/schema.ts";

export const api: AptTree = {
  "chat-completions": {
    post: {
      description: "AI Chat-Completions ausführen.",
      input: s.object({ data: s.record() }),
      execute: ({ data }: any, ctx: any) => ctx.app.ai.chatCompletions(data),
    },
  },
  "chat-session": {
    post: {
      description: "Bot-Chat-Session ausführen.",
      input: s.object({ data: s.record() }),
      execute: ({ data }: any, ctx: any) => ctx.app.ai.chatSession(data, ctx),
    },
  },
  "embeddings": {
    post: {
      description: "Text-Embeddings generieren.",
      input: s.object({ data: s.record() }),
      execute: ({ data }: any, ctx: any) => ctx.app.ai.embeddings(data),
    },
  },
  "image-generations": {
    post: {
      description: "Bild aus Text-Prompt generieren.",
      input: s.object({ data: s.record() }),
      execute: ({ data }: any, ctx: any) => ctx.app.ai.imageGenerations(data),
    },
  },
};
