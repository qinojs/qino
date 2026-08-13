import { errMsg, unixTime, type App, type Ctx } from "@qino/qino";
import { resolve } from "./registry.ts";
import { addUsage } from "./usage.ts";
import { readSse, sse } from "./sse.ts";
import { type AiApi, CHAT_DEFAULTS } from "./AiApi.ts";
import type { Bot, ProviderModelRow, Tool } from "../types.ts";
import type { Provider } from "./Provider.ts";

type Msg = Record<string, unknown>;

// A persistent chat: history + messages live in ai_session/ai_message.
// `run()` returns the final answer; `runStream()` yields an SSE stream.
export class ChatSession {
  #app: Pick<App, "db">;
  #api: AiApi;
  #id: number;
  get id(): number { return this.#id; }

  constructor(app: Pick<App, "db">, api: AiApi, id: number) {
    this.#app = app;
    this.#api = api;
    this.#id = id;
  }

  async run(content: string, ctx: Ctx, context?: Record<string, unknown>): Promise<string> {
    const { bot, messages } = await this.#prepare(content, ctx, context);
    try {
      const final = await this.#loop(messages, bot, ctx);
      await this.#touch();
      return final;
    } catch (e) {
      await this.#persistError(e);
      throw e;
    }
  }

  runStream(content: string, ctx: Ctx, context?: Record<string, unknown>): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start: async (controller) => {
        try {
          const { bot, messages } = await this.#prepare(content, ctx, context);
          try {
            const final = await this.#loop(messages, bot, ctx, (text) => controller.enqueue(sse({ delta: text })));
            await this.#touch();
            controller.enqueue(sse({ done: final }));
          } catch (e) {
            await this.#persistError(e); // record failed turns in the session history
            throw e;
          }
        } catch (e) {
          controller.enqueue(sse({ error: errMsg(e) }));
        } finally {
          controller.close();
        }
      },
    });
  }

  // Load session + history, persist the new user message, build the message list.
  async #prepare(content: string, ctx: Ctx, context?: Record<string, unknown>): Promise<{ bot: Bot; messages: Msg[] }> {
    const data = await this.#app.db.row`SELECT * FROM ai_session WHERE id = ${this.#id}`;
    if (!data) throw new Error("Session not found");
    if (Number(data.user_id) !== ctx.userId) throw new Error("Forbidden");

    // Fresh client context (e.g. current page) supersedes the one stored at session start.
    if (context) {
      data.context = JSON.stringify(context);
      await this.#app.db.table("ai_session").update(this.#id, { context: data.context });
    }

    const bot = this.#api.getBot(String(data.bot));
    if (!bot) throw new Error(`Bot not found: ${data.bot}`);

    const systemPrompt = typeof bot.systemPrompt === "function"
      ? await bot.systemPrompt(ctx, parseJson(data.context))
      : bot.systemPrompt;

    const rows = await this.#app.db.query`SELECT * FROM ai_message WHERE session_id = ${this.#id} ORDER BY id`;
    // Persist the exact system prompt once per session (for the record); the provider
    // always gets the freshly built one. `system` (rebuilt) and `error` (audit-only,
    // not a valid OpenAI role) rows are dropped from the history sent to the model.
    if (!rows.length) await this.#insert({ role: "system", content: systemPrompt });
    const history = rows.filter((r) => r.role !== "system" && r.role !== "error").map(rowToMessage);
    await this.#insert({ role: "user", content });
    history.push({ role: "user", content });

    return { bot, messages: [{ role: "system", content: systemPrompt }, ...history] };
  }

  // OpenAI tool loop. Always streams from the provider; `onDelta` forwards tokens
  // to the client (a no-op for the non-streaming `run`).
  async #loop(messages: Msg[], bot: Bot, ctx: Ctx, onDelta: (t: string) => void = () => {}): Promise<string> {
    const { provider, model } = await resolve(this.#app, { provider: bot.provider, model: bot.model, kind: "chat" });
    const client = await this.#api.client(provider);
    // Tools belong to the bot, not the model — always offer them (tool_choice defaults to
    // "auto"). A model without function-calling errors clearly instead of faking a text call.
    const tools = bot.tools?.length ? toOpenAiTools(bot.tools) : undefined;
    const modelId = model?.model_id ?? bot.model;

    for (let i = 0; i < 8; i++) {
      const assistant = await this.#turn(client, {
        model: modelId,
        messages,
        ...CHAT_DEFAULTS,
        ...(tools ? { tools } : {}),
      }, model, onDelta);

      const toolCalls = assistant.tool_calls as ToolCall[] | undefined;
      if (!toolCalls?.length) {
        const text = String(assistant.content ?? "");
        if (!text) throw new Error(`Empty response from "${provider.name}".`);
        await this.#insert({ role: "assistant", content: text, model: modelId });
        return text;
      }

      await this.#insert({ role: "assistant", content: String(assistant.content ?? ""), tool_calls: JSON.stringify(toolCalls), model: modelId });
      messages.push(assistant);
      for (const tc of toolCalls) {
        const out = await execTool(bot, tc.function?.name, tc.function?.arguments, ctx);
        const content = JSON.stringify(out);
        await this.#insert({ role: "tool", tool_call_id: String(tc.id ?? ""), name: String(tc.function?.name ?? ""), content });
        messages.push({ role: "tool", tool_call_id: tc.id, content });
      }
    }
    throw new Error("Max tool iterations reached");
  }

  // Stream one assistant turn, accumulating content + tool-call deltas (by index).
  async #turn(client: Provider, body: Msg, model: ProviderModelRow | undefined, onDelta: (t: string) => void): Promise<Msg> {
    const res = await client.stream("/chat/completions", body);
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}${text ? ": " + text.slice(0, 200) : ""}`);
    }
    let content = "";
    const toolCalls: ToolCall[] = [];
    let usage: unknown;
    await readSse(res, (data) => {
      if (data.usage) usage = data.usage;
      const delta = (data.choices as Msg[] | undefined)?.[0]?.delta as Msg | undefined;
      if (!delta) return;
      if (delta.content) { content += delta.content; onDelta(String(delta.content)); }
      for (const tc of (delta.tool_calls as ToolCall[] | undefined) ?? []) {
        const slot = (toolCalls[tc.index ?? 0] ??= { id: tc.id, type: "function", function: { name: "", arguments: "" } });
        const fn = slot.function!;
        const name = String(fn.name ?? "") + String(tc.function?.name ?? "");
        const args = String(fn.arguments ?? "") + String(tc.function?.arguments ?? "");
        Object.assign(slot, tc, { function: { ...fn, ...tc.function, name, arguments: args } });
      }
    });
    if (model && usage) await addUsage(this.#app, model, usage);
    const message: Msg = { role: "assistant", content };
    if (toolCalls.length) message.tool_calls = toolCalls;
    return message;
  }

  #insert(msg: { role: string; content?: string; tool_calls?: string; tool_call_id?: string; name?: string; model?: string }): Promise<unknown> {
    return this.#app.db.table("ai_message").insert({
      session_id: this.#id,
      role: msg.role,
      model: msg.model ?? "",
      content: msg.content ?? "",
      tool_calls: msg.tool_calls ?? "",
      tool_call_id: msg.tool_call_id ?? "",
      name: msg.name ?? "",
      created_at: unixTime(),
    });
  }

  async #persistError(e: unknown): Promise<void> {
    await this.#insert({ role: "error", content: errMsg(e) });
    await this.#touch();
  }

  #touch(): Promise<unknown> {
    return this.#app.db.table("ai_session").update(this.#id, { updated_at: unixTime() });
  }
}

type ToolCall = {
  id?: string;
  index?: number;
  type?: string;
  function?: { name?: string; arguments?: string };
};

function rowToMessage(row: Record<string, unknown>): Msg {
  const msg: Msg = { role: row.role, content: row.content ?? "" };
  if (row.tool_calls) { try { msg.tool_calls = JSON.parse(String(row.tool_calls)); } catch { /* ignore */ } }
  if (row.role === "tool") msg.tool_call_id = row.tool_call_id;
  return msg;
}

function toOpenAiTools(tools?: Tool[]): Msg[] | undefined {
  return tools?.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

async function execTool(bot: Bot, name: string | undefined, args: string | undefined, ctx: Ctx): Promise<unknown> {
  const tool = bot.tools?.find((t) => t.name === name);
  if (!tool) return { error: `Unknown tool: ${name}` };
  try { return await tool.execute(JSON.parse(args ?? "{}"), ctx); }
  catch (e) { return { error: String(e) }; }
}

function parseJson(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value) return {};
  try { return JSON.parse(value); }
  catch { return {}; }
}
