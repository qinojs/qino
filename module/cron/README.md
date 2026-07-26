# Cron

`cron` runs recurring module jobs without requiring an operating-system cron entry. A timer is
the primary trigger; incoming requests provide a throttled fallback. An external scheduler can
call `POST /api/cron/run` as a superuser when an independent heartbeat is required.

## Declaring jobs

Add `cron` as a dependency and export a job map from the module manifest:

```ts
import type { App } from "../core/mod.ts";
import type { Jobs } from "../cron/mod.ts";

export const name = "shop";
export const needs = ["core", "cron"];

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

async function cleanup(app: App, { signal, manual }: { signal: AbortSignal; manual: boolean }) {
  // Keep jobs idempotent and pass signal to cancellable operations.
}

async function sync(app: App) {
  // ...
}
```

`every` accepts `"hour"`, `"day"`, `"week"`, or seconds. `at` positions a calendar job within
its period: `{ minute: 15 }` for an hourly job, `{ hour: 3 }` for a daily job, or
`{ weekday: "sunday", hour: 12 }` for a weekly job. Missing fields default to the start of the
period; a weekly job defaults to Monday.

`jitter` is the maximum random deviation in seconds before or after an `every` schedule; the
example therefore runs between 01:00 and 05:00. The selected time is persisted, so every process
sees the same schedule. It may span at most half the interval so neighboring windows cannot overlap.
Invalid values fail during startup rather than being silently shortened.

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

Calendar schedules use `settings.cron.timezone` (`UTC` by default). Temporal handles local calendar
arithmetic and daylight-saving transitions.

Job IDs are derived as `<module>:<job>`. State and leases live in `cron_job`; simultaneous timer,
request, and external triggers therefore cannot claim the same run. Failed jobs retry with
exponential backoff. A process crash can cause a job to run again after its lease expires, so jobs
should be idempotent.

The public `run(app)`, `trigger(app, id)`, and `status(app)` helpers from `@qino/qino/cron` are
useful for host-level integration. `trigger` runs one job immediately without moving a future
scheduled run; its context has `manual: true`. Normal requests only kick the scheduler and never
wait for a job.

Link the optional `cms.backend.superuser.cron` module to inspect job state, run due jobs, and
trigger individual jobs from the backend.
