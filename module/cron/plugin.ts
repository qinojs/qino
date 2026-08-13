import { Scheduler } from "./scheduler.ts";

import type { App } from "@qino/qino";

export const settingsSchema = {
  properties: {
    timezone: { type: "string", default: "UTC", description: "IANA timezone used by calendar schedules." },
    pollSeconds: { type: "integer", minimum: 5, default: 60, description: "Maximum delay before due jobs are checked." },
  },
};

export const dbSchema = {
  properties: {
    cron_job: {
      additionalProperties: {
        properties: {
          id: { type: "string", maxLength: 191, "x-index": "primary" },
          schedule_key: { type: "string", maxLength: 255 },
          next_run: { type: "integer", "x-index": true },
          lock_id: { type: "string", maxLength: 32 },
          locked_until: { type: "integer", "x-index": true },
          last_started: { type: "integer" },
          last_finished: { type: "integer" },
          last_success: { type: "integer" },
          duration_ms: { type: "integer" },
          failures: { type: "integer" },
          last_error: { type: "string", maxLength: 65535 },
        },
        required: ["id", "schedule_key", "next_run", "lock_id", "locked_until", "last_started", "last_finished", "last_success", "duration_ms", "failures", "last_error"],
      },
    },
  },
};

export async function init(app: App, { signal }: { signal: AbortSignal }): Promise<void> {
  const scheduler = new Scheduler(app);
  await scheduler.init(signal);
  app.on("request-start", () => scheduler.kick(), { signal });
}
