import type { App } from "../../core/mod.ts";
import type { Bot, Kind, ProviderRow } from "../types.ts";
import { CmsHelperBot } from "../bots/cmsHelper.ts";
import { Provider } from "./Provider.ts";
import { ChatSession } from "./ChatSession.ts";
import { resolve } from "./registry.ts";
import { addUsage } from "./usage.ts";

const now = () => Math.floor(Date.now() / 1000);
const str = (v: unknown): string | undefined => v == null ? undefined : String(v);

// Shared chat request defaults (raw passthrough + session loop).
export const CHAT_DEFAULTS = { temperature: 0.6, max_tokens: 5512 };

// app.ai facade: bot registry, provider clients, raw passthroughs, sessions.
export class AiApi {
  #bots = new Map<string, Bot>();

  constructor(private app: Pick<App, "db" | "settings"> & { ai?: AiApi }) {
    this.registerBot(CmsHelperBot);
  }

  registerBot(bot: Bot): void { this.#bots.set(bot.id, bot); }
  getBot(id: string): Bot | undefined { return this.#bots.get(id); }

  /** Build a transport client for a provider row, pulling its key from settings. */
  async client(provider: ProviderRow): Promise<Provider> {
    const key = String(await this.app.settings.ai.provider[provider.name].key ?? "");
    if (!key) throw new Error(`No API key configured for provider "${provider.name}". Add it in the CMS settings.`);
    return new Provider(provider, key);
  }

  // --- Sessions ---

  async createSession(opts: { bot: string; context?: unknown; userId: number }): Promise<number> {
    if (!this.getBot(opts.bot)) throw new Error(`Bot not found: ${opts.bot}`);
    const id = await this.app.db.table("ai_session").insert({
      user_id: opts.userId,
      bot: opts.bot,
      context: opts.context ? JSON.stringify(opts.context) : "",
      created_at: now(),
      updated_at: now(),
    });
    return Number(id);
  }

  session(id: number): ChatSession {
    return new ChatSession(this.app, this, id);
  }

  // --- Raw passthroughs (OpenAI-compatible) ---

  chat(data: Record<string, unknown>): Promise<unknown> {
    return this.#send("chat", str(data._provider), str(data.model), "/chat/completions", (modelId) => {
      const body: Record<string, unknown> = { ...data };
      delete body._provider;
      body.model = modelId ?? data.model;
      body.temperature ??= CHAT_DEFAULTS.temperature;
      body.max_tokens ??= CHAT_DEFAULTS.max_tokens;
      body.top_p ??= 1;
      body.n ??= 1;
      body.stream = false;
      return body;
    });
  }

  embeddings(data: { input: string | string[]; model?: string; _provider?: string }): Promise<unknown> {
    return this.#send("embedding", data._provider, data.model, "/embeddings", (modelId) => {
      if (!(modelId ?? data.model)) throw new Error("No embedding model configured.");
      return { model: modelId ?? data.model, input: data.input };
    });
  }

  images(data: Record<string, unknown>): Promise<unknown> {
    return this.#send("image", str(data._provider), str(data.model), "/images/generations", (modelId) => {
      const body: Record<string, unknown> = { ...data };
      delete body._provider;
      body.model = modelId ?? data.model;
      body.n ??= 1;
      return body;
    }, false);
  }

  // Resolve provider+model, call the endpoint, track usage, normalise errors to `{ error }`.
  async #send(kind: Kind, provider: string | undefined, model: string | undefined, path: string, body: (modelId?: string) => Record<string, unknown>, trackUsage = true): Promise<unknown> {
    try {
      const resolved = await resolve(this.app, { provider, model, kind });
      const result = await (await this.client(resolved.provider)).json(path, body(resolved.model?.model_id));
      if (trackUsage && !result.error && resolved.model) await addUsage(this.app, resolved.model, result.usage);
      return result;
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }
}
