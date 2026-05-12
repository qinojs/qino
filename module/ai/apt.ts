// deno-lint-ignore-file no-explicit-any
import type { AptTree } from "../core/lib/apt.ts";
import { Access } from "../core/lib/apt.ts";
import { s } from "../core/lib/StandardSchema.ts";

export const api: AptTree = {
  "chat-completions": {
    post: {
      description: "Run AI chat completions",
      input: s.object({ data: s.record() }),
      access: Access.USER,
      execute: ({ data }: any, ctx: any) => ctx.app.ai.chatCompletions(data),
    },
  },
  "chat-session": {
    post: {
      description: "Run a bot chat session",
      input: s.object({ data: s.record() }),
      access: Access.USER,
      execute: ({ data }: any, ctx: any) => ctx.app.ai.chatSession(data, ctx),
    },
  },
  "embeddings": {
    post: {
      description: "Generate text embeddings",
      input: s.object({ data: s.record() }),
      access: Access.USER,
      execute: ({ data }: any, ctx: any) => ctx.app.ai.embeddings(data),
    },
  },
  "image-generations": {
    post: {
      description: "Generate an image from a text prompt",
      input: s.object({ data: s.record() }),
      access: Access.USER,
      execute: ({ data }: any, ctx: any) => ctx.app.ai.imageGenerations(data),
    },
  },
};
