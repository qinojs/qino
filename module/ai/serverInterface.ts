// deno-lint-ignore-file no-explicit-any
import { serverInterface } from "../core/lib/serverInterface.ts";

serverInterface.ai = {
  chatCompletions(data: Record<string, unknown>): Promise<any> {
    return this.ctx.app.apt.ai["chat-completions"].post({ data });
  },

  chatSession(data: { bot: string; messages: Array<{ role: string; content: string }>; context?: Record<string, unknown> }): Promise<any> {
    return this.ctx.app.apt.ai["chat-session"].post({ data });
  },

  embeddings(data: { input: string | string[]; model?: string; _provider?: string }): Promise<any> {
    return this.ctx.app.apt.ai["embeddings"].post({ data });
  },

  imageGenerations(data: Record<string, unknown>): Promise<any> {
    return this.ctx.app.apt.ai["image-generations"].post({ data });
  },
};
