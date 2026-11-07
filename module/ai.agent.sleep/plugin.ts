import { answered, sleep } from "./lib/sleep.ts";
import { compact, compacted } from "./lib/compaction.ts";

import type { App } from "@qino/qino";
import type { Jobs } from "@qino/qino/cron";

export { api } from "./api.ts";
export { default as dbSchema } from "./dbschema.json" with { type: "json" };

// What an agent does while nobody talks with it: compacting long sessions, and sleeping once it rests.
// Hooked into ai.agent, so it can be left out or replaced for experiments.

export const settingsSchema = {
  properties: {
    thinkers: { type: "string", default: "", description: "Models that think the conversations over, comma-separated; empty: one, as ai chooses." },
    merger: { type: "string", default: "", description: "The model that weighs the thoughts; empty: as ai chooses." },
    apply: { type: "boolean", default: true, description: "Carry out a sleep's plan at once; off, it waits to be reviewed and applied, and the agent sleeps again only after." },
    minChars: { type: "integer", minimum: 0, default: 2000, description: "An agent sleeps once this many characters were said since it last slept; \"Sleep now\" on whatever is new." },
    sessions: { type: "integer", minimum: 0, default: 200, description: "At most this many sessions per sleep, all agents together." },
    chars: { type: "integer", minimum: 1000, default: 200000, description: "Of a session, at most this many characters, the latest." },
  },
};

export const cron = {
  sleep: {
    every: "hour",
    run: (app: App) => sleep(app),
  },
} satisfies Jobs;

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.on("ai.agent:history", async (turn) => { turn.history = await compacted(app, turn.session, turn.history); }, { signal });
  app.on("ai.agent:answered", (turn) => compact(app, turn), { signal });
  app.on("ai:batched", (e) => e.owner === "ai.agent.sleep" ? answered(app, e) : undefined, { signal });
}
