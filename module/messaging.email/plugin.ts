import { receive, send } from "./mod.ts";
import { close } from "./lib/transport.ts";

import type { App } from "@qino/qino";
import type { Jobs } from "@qino/qino/cron";
import type { Channel } from "@qino/qino/messaging";

export { settingsSchema } from "./lib/settings.ts";

export const messagingChannel: Channel = {
  name: "email",
  label: "Email",
  color: "--orange",
  reach: async (app: App, usrId: number) =>
    await app.db.one`SELECT email FROM usr WHERE id = ${usrId}` ? 1 : 0,
  send,
};

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
