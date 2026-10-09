import { compact, compacted } from "./lib/session.compaction.ts";

import type { App } from "@qino/qino";

export { api } from "./api.ts";

// What an agent does while nobody talks with it, as sleep: for now compacting long sessions.
// Hooked into ai1.agent, so it can be left out or replaced for experiments.

export async function init(app: App, { signal }: { signal: AbortSignal }): Promise<void> {
  app.on("ai1.agent:history", async (turn) => { turn.history = await compacted(app, turn.session, turn.history); }, { signal });
  app.on("ai1.agent:answered", (turn) => compact(app, turn), { signal });
}
