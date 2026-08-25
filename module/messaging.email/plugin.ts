import { close } from "./lib/transport.ts";
import { receive } from "./mod.ts";

import type { App } from "@qino/qino";
import type { Jobs } from "@qino/qino/cron";

export { messagingChannel } from "./mod.ts";

export { settingsSchema } from "./lib/settings.ts";
export { healthChecks } from "./healthChecks.ts";

// Mail arrives by being fetched, so the channel is only as live as this interval.
export const cron = {
  inbox: {
    every: 300,
    timeout: 120,
    run: (app: App) => receive(app),
  },
} satisfies Jobs;

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  signal.addEventListener("abort", () => close(app), { once: true });
}
