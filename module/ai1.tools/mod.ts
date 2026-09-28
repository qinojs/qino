import { ApiError, getCtx, runAs } from "@qino/qino";
import { text } from "@qino/qino/ai1";

import type { App, Ctx, Tool } from "@qino/qino";
import type { Message, Opts, TextInput, TextOutput } from "@qino/qino/ai1";

type ToolCall = TextOutput["toolCalls"][number];

/** A tool's result for the model; a failure is told to it, so it can go on. */
function execute(tools: Tool[], call: ToolCall, ctx: Ctx): Promise<unknown> {
  const tool = tools.find((t) => t.name === call.name);
  return (tool ? tool.execute(call.args, ctx) : Promise.reject(new ApiError(404, `Unknown tool: ${call.name}`)))
    .catch((e) => e instanceof ApiError ? { error: e.message, code: e.code, data: e.data } : (console.error("[ai1.tools]", call.name, e), { error: "Tool failed" }));
}

/** Answer the messages, running the tools the model calls until it answers without; `messages` are
 *  the new ones (assistant and tool), for a history to keep. The run acts as user `usrId` (its
 *  rights bound the tools), through the actor "ai1". `maxSteps` (default 8) bounds the calls. */
export function run(app: App, { usrId, tools, maxSteps = 8, ...input }: Omit<TextInput, "tools"> & { tools: Tool[]; usrId: number; maxSteps?: number }, opts?: Opts): Promise<TextOutput & { messages: Message[] }> {
  return runAs(app, usrId, "ai1", async () => {
    const messages: Message[] = [], ctx = getCtx();
    for (let step = 0; step < maxSteps; step++) {
      const answer = await text(app, { ...input, tools, messages: [...input.messages, ...messages] }, opts);
      messages.push({ role: "assistant", content: answer.text, toolCalls: answer.toolCalls });
      if (!answer.toolCalls.length) return { ...answer, messages };
      for (const call of answer.toolCalls) messages.push({ role: "tool", id: call.id, content: JSON.stringify(await execute(tools, call, ctx) ?? null) });
    }
    throw new Error(`No answer after ${maxSteps} steps`);
  });
}
