import { ApiError, getCtx, runAs } from "@qino/qino";
import { text } from "@qino/qino/ai";

import type { App, Ctx, Tool } from "@qino/qino";
import type { Message, Opts, Part, TextInput, TextOutput } from "@qino/qino/ai";

type ToolCall = TextOutput["toolCalls"][number];

/** A result longer than this many characters doesn't go to the model: it would fill its context. */
const MAX_RESULT = 100_000;

// deno-lint-ignore no-explicit-any
const isPart = (v: any): v is Part =>
  v?.type === "image" ? typeof v.url === "string" : v?.type === "text" && typeof v.text === "string";

/** A tool's result for the model, as JSON; one with images (a `Part`, or `Part`s) as they are, so the
 *  model sees them. A failure is told to it, so it can go on, as is a result too long, so it asks for less. */
export async function execute(tools: Tool[], call: ToolCall, ctx: Ctx): Promise<string | Part[]> {
  const tool = tools.find((t) => t.name === call.name);
  const value = await (tool ? tool.execute(call.args, ctx) : Promise.reject(new ApiError(404, `Unknown tool: ${call.name}`)))
    .catch((e) => e instanceof ApiError
      ? { error: e.message, code: e.code, data: e.data }
      : (console.error("[ai.tools]", call.name, e), { error: "Tool failed" }));
  const parts = isPart(value) ? [value] : Array.isArray(value) && value.length && value.every(isPart) ? value : [];
  if (parts.some((p) => p.type === "image")) return parts;
  const result = JSON.stringify(value ?? null);
  return result.length > MAX_RESULT ? JSON.stringify({ error: `Too long: ${result.length} characters, at most ${MAX_RESULT}. Ask for less.` }) : result;
}

/** Answer the messages, running the tools the model calls until it answers without; `messages` are
 *  the new ones (assistant and tool), for a history to keep; `onMessage` gets each as it comes, an
 *  answer with the model at its provider that gave it. The run acts as user `usrId` (its rights bound
 *  the tools), through the actor "ai". `maxSteps` (default 10) bounds the calls. Each step sends the
 *  history again: `cache` (default true) keeps it in the provider's cache. `notes` gives messages to add
 *  before each step, e.g. what came up while the last one ran. */
export function run(app: App, { usrId, tools, maxSteps = 10, onMessage, notes, cache = true, ...input }: Omit<TextInput, "tools"> & {
  tools: Tool[];
  usrId: number;
  maxSteps?: number;
  onMessage?: (message: Message, modelProvider?: number) => unknown;
  notes?: () => Message[];
}, opts?: Opts): Promise<TextOutput & { messages: Message[] }> {
  return runAs(app, usrId, "ai", async () => {
    const messages: Message[] = [], ctx = getCtx();
    const add = async (message: Message, modelProvider?: number) => { messages.push(message); await onMessage?.(message, modelProvider); };
    for (let step = 0, pin = opts; step < maxSteps; step++) {
      for (const note of notes?.() ?? []) await add(note);
      const answer = await text(app, { ...input, cache, tools, messages: [...input.messages, ...messages] }, pin);
      pin = { ...opts, model: answer.model, modelProvider: answer.modelProvider }; // prefer the provider with the cached history
      await add({ role: "assistant", content: answer.text, toolCalls: answer.toolCalls }, answer.modelProvider);
      if (!answer.toolCalls.length) return { ...answer, messages };
      for (const call of answer.toolCalls) await add({ role: "tool", id: call.id, content: await execute(tools, call, ctx) });
    }
    throw new Error(`No answer after ${maxSteps} steps`);
  });
}
