import { errMsg } from "@qino/qino";

import { recall } from "./lib/recall.ts";

import type { App } from "@qino/qino";

// What comes to mind as the user talks, as with a person: what is close to what was said and not in
// the agent's context. Hooked into ai.agent, so it can be left out or replaced for experiments.

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.on("ai.agent:associate", ({ agent, session, vector }) =>
    recall(app, agent, session, vector).catch((e) => console.error("[ai.agent.recall]", errMsg(e))), { signal });
}
