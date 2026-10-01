import { App, s } from "@qino/qino";

import { WEEKDAYS } from "./calendar.ts";
import { Scheduler } from "./scheduler.ts";

import type { Jobs } from "./mod.ts";

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

const data = s.object({
  time: s.number().describe("When it fired, unix time."),
  date: s.string().describe("The date in settings.cron.timezone, e.g. 2026-10-01."),
  weekday: s.string().describe("The weekday in settings.cron.timezone, e.g. monday."),
  hour: s.number().describe("The hour in settings.cron.timezone, 0-23."),
});

Object.assign(App.events, {
  "cron:hour": { description: "A new hour began; fires once at the start of every hour, a missed one is caught up once.", data },
  "cron:day": { description: "A new day began; fires once at midnight, a missed one is caught up once.", data },
});

/** A job firing a time event. A failing listener is logged, not retried: that would fire it again for all. */
const fire = (event: "cron:hour" | "cron:day") => async (app: App) => {
  const now = Temporal.Now.zonedDateTimeISO(String(await app.settings.cron.timezone));
  const time = Math.floor(now.epochMilliseconds / 1000), weekday = WEEKDAYS[now.dayOfWeek - 1];
  await app.fire(event, { time, date: now.toPlainDate().toString(), weekday, hour: now.hour })
    .catch((e) => console.error(`cron: a listener of ${event}:`, e));
};

/** The time events, for whoever wants to act on time without a job of their own (e.g. flows). */
export const cron = {
  hour: { every: "hour", run: fire("cron:hour") },
  day: { every: "day", run: fire("cron:day") },
} satisfies Jobs;

export async function init(app: App, { signal }: { signal: AbortSignal }): Promise<void> {
  const scheduler = new Scheduler(app);
  await scheduler.init(signal);
  app.on("request-start", () => scheduler.kick(), { signal });
}
