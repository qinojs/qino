import type { Bot } from "../types.ts";
import { CmsHelperBot } from "../bots/cmsHelper.ts";
import { chatCompletions } from "./chatCompletions.ts";
import { chatSession } from "./chatSession.ts";
import { embeddings } from "./embeddings.ts";
import { imageGenerations } from "./imageGenerations.ts";
import type { App, RequestContext } from "../../core/mod.ts";

export class AiApi {
  private bots = new Map<string, Bot>();

  constructor(private app: Pick<App, "settings"> & { ai?: AiApi }) {
    this.registerBot(CmsHelperBot);
  }

  registerBot(bot: Bot) {
    this.bots.set(bot.id, bot);
  }

  getBot(id: string) {
    return this.bots.get(id);
  }

  chatCompletions(data: Record<string, unknown>) {
    return chatCompletions(data, this.app);
  }

  chatSession(data: Parameters<typeof chatSession>[0], ctx: RequestContext) {
    return chatSession(data, this.app, ctx);
  }

  embeddings(data: Parameters<typeof embeddings>[0]) {
    return embeddings(data, this.app);
  }

  imageGenerations(data: Record<string, unknown>) {
    return imageGenerations(data, this.app);
  }
}
