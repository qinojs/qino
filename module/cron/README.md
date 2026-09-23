# Cron

`cron` runs recurring module jobs without a system cron entry. A timer triggers them; incoming
requests serve as a throttled fallback.

## Declaring jobs

Add `cron` to the `dependencies` in `manifest.json` and export the jobs from `plugin.ts`:

```ts
import type { App } from "@qino/qino";
import type { Jobs } from "@qino/qino/cron";

export const cron = {
  cleanup: {
    every: "day",
    at: { hour: 3 },
    jitter: 2 * 60 * 60,
    run: cleanup,
  },
  sync: {
    every: 15 * 60,
    timeout: 2 * 60,
    run: sync,
  },
} satisfies Jobs;

async function cleanup(app: App, { signal }: { signal: AbortSignal }) {
  // Keep jobs idempotent and pass signal to cancellable operations.
}

async function sync(app: App) {
  // ...
}
```

`every` is `"hour"`, `"day"`, `"week"` or seconds. `at` sets the time within the period:
`{ minute: 15 }` hourly, `{ hour: 3 }` daily, `{ weekday: "sunday", hour: 12 }` weekly. Missing
fields default to the start of the period (Monday for weekly). An interval job (`every: 900`)
counts from the end of its last run, so a long run delays the next ones.

`jitter` is the maximum random shift in seconds before or after the scheduled time; the example
runs between 01:00 and 05:00. The chosen time is stored, so all processes agree. It may be at most
half the interval, so windows don't overlap; invalid values fail at startup.

```ts
const sunday = {
  every: "week",
  at: { weekday: "sunday", hour: 12 },
  jitter: 12 * 60 * 60, // Sunday 00:00 until Monday 00:00
};

const hourly = {
  every: "hour",
  at: { minute: 27, second: 30 },
  jitter: 5 * 60 + 30, // xx:22:00 until xx:33:00
};
```

Calendar schedules use `settings.cron.timezone` (default `UTC`); Temporal handles daylight saving.

Job ids are `<module>:<job>`. State and leases are stored in `cron_job`, so timer, request and
external triggers never run the same job twice at once. Due jobs of one tick run in parallel.
Failed jobs retry with exponential backoff; a job cancelled by shutdown just releases its lease. A
crash may cause a job to run again after the lease expires, so jobs should be idempotent.

Public API from `@qino/qino/cron`: `run(app)`, `trigger(app, id)`, `status(app)` — e.g. for an
external heartbeat. `trigger` runs one job now without using up an upcoming scheduled run. Normal
requests only nudge the scheduler and never wait. All three throw while the module is not linked.

The optional `cms.backend.superuser.cron` module shows job state and runs jobs from the backend.
