import { unixTime, type App } from "../../core/mod.ts";
import type { Bot, Kind, ProviderRow } from "../types.ts";
import { Provider } from "./Provider.ts";
import { ChatSession } from "./ChatSession.ts";
import { resolve } from "./registry.ts";
import { addUsage } from "./usage.ts";

const str = (v: unknown): string | undefined => v == null ? undefined : String(v);

// Shared chat request defaults (raw passthrough + session loop).
export const CHAT_DEFAULTS = { temperature: 0.6, max_tokens: 5512 };

// Per-app instances; the plugin's init binds, ai()/ai.get() read. Internal — mod.ts does not export it.
export const aiInstances = new WeakMap<object, AiApi>();

// ai(app) facade: bot registry, provider clients, raw passthroughs, sessions.
export class AiApi {
  #bots = new Map<string, Bot>();
  #app: Pick<App, "db" | "settings">;
  get app(): Pick<App, "db" | "settings"> { return this.#app; }

  constructor(app: Pick<App, "db" | "settings">) { this.#app = app; }

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
      created_at: unixTime(),
      updated_at: unixTime(),
    });
    return Number(id);
  }

  session(id: number): ChatSession {
    return new ChatSession(this.app, this, id);
  }

  // --- Raw passthroughs (OpenAI-compatible) ---

  chat(data: Record<string, unknown>): Promise<unknown> {
    return this.#chat("chat", data);
  }

  /** Chat completion resolved against a "vision" model (image input, e.g. OCR) */
  vision(data: Record<string, unknown>): Promise<unknown> {
    return this.#chat("vision", data);
  }

  #chat(kind: Kind, data: Record<string, unknown>): Promise<unknown> {
    return this.#send(kind, str(data._provider), str(data.model), "/chat/completions", (modelId) => {
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

  transcription(data: Record<string, unknown>): Promise<unknown> {
    return this.#sendForm("stt", str(data._provider), str(data.model), "/audio/transcriptions", async (modelId) => {
      const file = str(data.file);
      if (!file) throw new Error("No transcription file given.");
      const body = new FormData();
      body.set("file", new Blob([await Deno.readFile(file)], { type: str(data.mime) ?? "application/octet-stream" }), str(data.filename) ?? "audio");
      body.set("model", modelId ?? str(data.model) ?? "");
      for (const [k, v] of Object.entries(data)) {
        if (["_provider", "model", "file", "mime", "filename"].includes(k) || v == null) continue;
        body.set(k, String(v));
      }
      if (!body.get("model")) throw new Error("No speech-to-text model configured.");
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

  async #sendForm(kind: Kind, provider: string | undefined, model: string | undefined, path: string, body: (modelId?: string) => Promise<FormData>, trackUsage = true): Promise<unknown> {
    try {
      const resolved = await resolve(this.app, { provider, model, kind });
      const result = await (await this.client(resolved.provider)).form(path, await body(resolved.model?.model_id));
      if (trackUsage && !result.error && resolved.model) await addUsage(this.app, resolved.model, result.usage);
      return result;
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }
}
