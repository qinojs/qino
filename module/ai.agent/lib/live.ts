import { errMsg, getCtx, runAs } from "@qino/qino";
import { live as connect } from "@qino/qino/ai1";
import { execute } from "@qino/qino/ai1.tools";

import { context } from "./context.ts";
import { save } from "./record.ts";
import { textOf } from "./search.ts";
import { ask } from "./turn.ts";

import type { App, Tool } from "@qino/qino";

// Talking live with an agent: a live model is its voice, with its role, memories and tools; a big task
// it hands over to the agent in writing (`ask`), whose stronger model does it. The media go straight
// between browser and provider; what is said and done is kept in the session, as in writing.

/** A live talk ends after this long at most. */
const LIVE_MS = 60 * 60_000;
/** How many of the last messages a live model is told: it takes no long history. */
const SO_FAR = 20;

/** Talk live in `session`: `sdp` is the browser's WebRTC offer, the answer's goes back to it. */
export async function live(app: App, session: number, sdp: string): Promise<string> {
  const { agent, usrId, prefer, tools, messages } = await context(app, session);
  const [first, ...history] = messages;
  const said = (first?.role === "system" ? history : messages)
    .filter((m) => (m.role === "user" || m.role === "assistant") && textOf(m.content))
    .map((m) => `${m.role}: ${textOf(m.content)}`)
    .slice(-SO_FAR).join("\n");
  const instructions = [
    first?.role === "system" ? textOf(first.content) : "",
    "You talk live, by voice: answer briefly, as one speaks. Hand bigger tasks over with delegate_task.",
    said && `## The session so far\n${said}`,
  ].filter(Boolean).join("\n\n");
  const delegate: Tool = {
    name: "delegate_task",
    description: "Hand a bigger task over to yourself in writing: a stronger model does it with all your tools; " +
      "tell the user what it answers",
    parameters: {
      type: "object", properties: { task: { type: "string", description: "What to do, with all it needs" } }, required: ["task"],
    },
    execute: async (args) => (await ask(app, session, String((args as { task?: string }).task ?? ""))).text,
  };
  const all = [...tools, delegate];
  const call = await connect(app, {
    sdp, instructions, tools: all,
    onToolCall: (toolCall) => runAs(app, usrId, "ai1", () => execute(all, toolCall, getCtx())),
    onMessage: (message) => save(app, session, agent, message).catch((e) => console.error("[ai1.agent] live:", errMsg(e))),
  }, { prefer });
  const timer = setTimeout(() => call.close().catch(() => {}), LIVE_MS);
  call.done.then(() => clearTimeout(timer));
  return call.sdp;
}
