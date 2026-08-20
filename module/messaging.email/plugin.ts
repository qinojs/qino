import { receive, send } from "./mod.ts";
import { close } from "./lib/transport.ts";

import { countContacts } from "@qino/qino";

import type { App } from "@qino/qino";
import type { Jobs } from "@qino/qino/cron";
import type { Channel } from "@qino/qino/messaging";

export { settingsSchema } from "./lib/settings.ts";
export { healthChecks } from "./healthChecks.ts";

export const messagingChannel: Channel = {
  name: "email",
  label: "Email",
  color: "--orange",
  contact: "email",
  reach: (app: App, usrId: number) => countContacts(app.db, usrId, "email"),
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
