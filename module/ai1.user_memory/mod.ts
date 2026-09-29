import { decide } from "@qino/qino/ai1";

import type { App } from "@qino/qino";

const QUESTION = "Is this about the person talking (their language, how to address them, their preferences, private matters) rather than about the work or the world?";

/** Whether a memory is about the person talking ("personal") or not ("shared"), as a quick `decide()` judges. */
export const personal = (app: App, content: string): Promise<{ choice: string; probabilities?: Record<string, number> }> =>
  decide(app, { content, question: QUESTION, options: ["personal", "shared"] });
