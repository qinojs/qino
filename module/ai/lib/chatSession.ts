// deno-lint-ignore-file no-explicit-any
import type { Bot, Tool } from "../types.ts";
import { chatCompletions } from "./chatCompletions.ts";
import { providerModels } from "./providerModels.ts";
import { providers } from "./providers.ts";

export async function chatSession(
  data: {
    bot: string;
    messages: Array<{ role: string; content: string }>;
    context?: Record<string, unknown>;
  },
  app: any,
  ctx: any,
): Promise<string | Record<string, unknown>> {
  const bot: Bot = app.ai?.getBot(data.bot);
  if (!bot) return { error: `Bot not found: ${data.bot}` };

  const defaultProviderName = String(
    await app.settings.ai.default.provider ?? "",
  );
  const providerName = String(bot.provider ?? defaultProviderName);
  const provider = providers[providerName];
  const defaultModel = String(await app.settings.ai.default.model ?? "");
  const models = await providerModels(app, providerName);
  const resolvedModel = bot.model ??
    (providerName === defaultProviderName
      ? defaultModel || provider?.defaultModel || models[0]?.id
      : provider?.defaultModel || models[0]?.id || defaultModel);
  const model = models.find((entry) => entry.id === resolvedModel);
  const supportsTools = model
    ? model.supports?.tools === true
    : provider?.supports?.tools === true;
  const supportsToolChoiceAuto = model
    ? model.supports?.toolChoiceAuto === true
    : provider?.supports?.toolChoiceAuto === true;
  const supportsJsonMode = model
    ? model.supports?.jsonMode === true
    : provider?.supports?.jsonMode === true || provider?.jsonMode === true;
  const wantsStructuredOutput = !!bot.chatSchema && supportsJsonMode;

  const systemPrompt = typeof bot.systemPrompt === "function"
    ? await bot.systemPrompt(ctx, data.context ?? {})
    : bot.systemPrompt;

  const schema = bot.chatSchema;
  const fullSystemPrompt = wantsStructuredOutput
    ? systemPrompt + `\n\nAlways respond with JSON matching this schema:\n${JSON.stringify(schema)}`
    : systemPrompt;

  const messages: Record<string, unknown>[] = [
    { role: "system", content: fullSystemPrompt },
    ...data.messages,
  ];

  const tools = bot.tools?.map((t: Tool) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
  const activeTools = supportsTools ? tools : undefined;
  const toolOptions = activeTools?.length
    ? {
      tools: activeTools,
      ...(supportsToolChoiceAuto ? { tool_choice: "auto" } : {}),
    }
    : {};

  for (let i = 0; i < 8; i++) {
    const result = await chatCompletions({
      _provider: bot.provider,
      model: bot.model,
      messages,
      ...toolOptions,
      ...(wantsStructuredOutput && !activeTools?.length
        ? { response_format: { type: "json_object" } }
        : {}),
    }, app);

    if (result?.error) {
      const err = result.error;
      return {
        error: typeof err === "string"
          ? err
          : (err?.message ?? JSON.stringify(err)),
      };
    }

    const message = result?.choices?.[0]?.message;
    if (!message?.tool_calls?.length) {
      const content = message?.content ?? "";
      if (!String(content).trim()) {
        const finishReason = result?.choices?.[0]?.finish_reason;
        return {
          error: `Empty response from provider "${providerName}"${
            resolvedModel ? ` model "${resolvedModel}"` : ""
          }${finishReason ? ` (finish_reason: ${finishReason})` : ""}.`,
        };
      }
      messages.push({ role: "assistant", content });
      console.log(
        `\n[bot:${data.bot}] conversation:\n` +
          messages.map((m) => {
            const role = String(m.role).toUpperCase();
            const body = typeof m.content === "string"
              ? m.content
              : JSON.stringify(m.content);
            return `--- ${role} ---\n${body}`;
          }).join("\n") +
          "\n",
      );
      if (!wantsStructuredOutput) return content;
      try { return JSON.parse(content); }
      catch { return { response: content }; }
    }

    messages.push(message);
    for (const tc of message.tool_calls) {
      const tool = bot.tools?.find((t: Tool) => t.name === tc.function.name);
      let toolResult: unknown;
      try {
        toolResult = tool
          ? await tool.execute(JSON.parse(tc.function.arguments ?? "{}"), ctx)
          : { error: `Unknown tool: ${tc.function.name}` };
        console.log(
          `[tool:${tc.function.name}] args:`,
          tc.function.arguments,
          "→",
          JSON.stringify(toolResult).slice(0, 200),
        );
      } catch (e) {
        console.error(
          `[tool:${tc.function.name}] args:`,
          tc.function.arguments,
          e,
        );
        toolResult = { error: String(e) };
      }
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(toolResult),
      });
    }
  }

  return { error: "Max tool iterations reached" };
}
