import { App, s } from "@qino/qino";
import { scored } from "@qino/qino/score";

import { declare } from "./lib/declared.ts";

import type { EventDecls } from "@qino/qino";

export { api } from "./api.ts";
export { default as dbSchema } from "./dbschema.json" with { type: "json" };

const agent = s.number().describe("The agent's id.");
const session = s.number().describe("The session's id.");

Object.assign(App.events, {
  "ai1.agent:turn": {
    description: "An agent is about to answer; add context and tools.",
    data: s.object({
      agent, session,
      usrId: s.number().describe("The user it talks with."),
      parts: s.array(s.string()).describe("Texts for its context; push yours."),
      tools: s.array(s.any()).describe("Tools it may use; push yours."),
    }),
  },
  "ai1.agent:remember": {
    description: "An agent keeps a new memory; take it over to keep it elsewhere.",
    data: s.object({
      agent,
      content: s.string().describe("The memory."),
      prevent: s.boolean().describe("Set to true to keep it yourself."),
      result: s.any().describe("What remember() returns then."),
    }),
  },
  "ai1.agent:associate": {
    description: "What the user said, as a vector; in the background.",
    data: s.object({ agent, session, vector: s.array(s.number()).describe("The message's embedding.") }),
  },
  "ai1.agent:history": {
    description: "What is sent of a session's history, before each turn; replace it to send less (compaction). What is kept stays.",
    data: s.object({
      agent, session,
      history: s.array(s.object({ id: s.number(), message: s.any() })).describe("The kept messages to send, oldest first, with their ids."),
    }),
  },
  "ai1.agent:answered": {
    description: "An agent answered; all it was given and answered, as sent. In the background.",
    data: s.object({
      agent, session,
      usrId: s.number().describe("The user it talks with."),
      messages: s.array(s.any()).describe("The messages as sent, then the answer's."),
      tools: s.array(s.any()).describe("The tools as offered, running."),
      model: s.string(), modelProvider: s.number().describe("Who answered: the model at its provider."),
      prefer: s.optional(s.record()).describe("How the model was chosen."),
    }),
  },
} satisfies EventDecls);

export async function init(app: App): Promise<void> {
  await scored(app.db, "ai1_agent_memory", 30 * 86400); // memories fade with a half-life of a month unless used

  await declare(app); // the agents modules bring (`agents/*.md`), as their files say now
}
