import { Access, type AptTree, s, type Params, type RequestContext } from "../core/mod.ts";

export const api: AptTree = {
  "chat-completions": {
    post: {
      description: "Run AI chat completions",
      input: s.object({ data: s.record() }),
      access: Access.USER,
      execute: ({ data }: Params, ctx: RequestContext) => ctx.app.ai.chatCompletions(data as Record<string, unknown>),
    },
  },
  "chat-session": {
    post: {
      description: "Run a bot chat session",
      input: s.object({ data: s.record() }),
      access: Access.USER,
      execute: ({ data }: Params, ctx: RequestContext) => ctx.app.ai.chatSession(data as never, ctx),
    },
  },
  "embeddings": {
    post: {
      description: "Generate text embeddings",
      input: s.object({ data: s.record() }),
      access: Access.USER,
      execute: ({ data }: Params, ctx: RequestContext) => ctx.app.ai.embeddings(data as never),
    },
  },
  "image-generations": {
    post: {
      description: "Generate an image from a text prompt",
      input: s.object({ data: s.record() }),
      access: Access.USER,
      execute: ({ data }: Params, ctx: RequestContext) => ctx.app.ai.imageGenerations(data as Record<string, unknown>),
    },
  },
};
