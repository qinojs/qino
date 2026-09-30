import { App, s } from "@qino/qino";
import { scored } from "@qino/qino/score";

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
} satisfies EventDecls);

/** Memories fade with a half-life of a month unless they are used. */
export const init = (app: App): Promise<void> => scored(app.db, "ai1_agent_memory", 30 * 86400);
