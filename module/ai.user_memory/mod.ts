import { decide } from "@qino/qino/ai1";

import type { App } from "@qino/qino";

/** How many of a user's memories are in the context: the strongest, those kept most and latest. */
export const IN_MIND = 10; // todo? adjustable

// A wish how this agent works ("use subagents") is for the agent, even if the user wished it.
const QUESTION = "Should every other agent, even with a different job, know this about the person?";
const OPTIONS = {
  personal: "about the person: name, language, how to address them, private matters",
  shared: "for this agent: how it works, its tools, the work, the world",
};

/** Whether a memory is about the person talking ("personal") or for the agent ("shared"), as a quick `decide()` judges. */
export const personal = (app: App, content: string): Promise<{ choice: string; probabilities?: Record<string, number> }> =>
  decide(app, { content, question: QUESTION, options: OPTIONS });
