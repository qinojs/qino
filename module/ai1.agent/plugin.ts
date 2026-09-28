import { scored } from "@qino/qino/score";

import type { App } from "@qino/qino";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

/** Memories fade with a half-life of a month unless they are used. */
export const init = (app: App): Promise<void> => scored(app.db, "ai1_agent_memory", 30 * 86400);
