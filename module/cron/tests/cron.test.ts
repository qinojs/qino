import { assert, assertEquals, assertThrows } from "../../core/tests/deps.ts";
import { Db, type App } from "../../core/mod.ts";
import { Emitter } from "../../core/lib/Emitter.ts";
import type { Every, Job, RunResult } from "../mod.ts";
import { run, status, trigger } from "../mod.ts";
import { init } from "../plugin.ts";
import { nextRun, scheduleKey, validateJob } from "../schedule.ts";
import { Scheduler } from "../scheduler.ts";

const noop = () => {};
const job = (every: Every, options: Partial<Job> = {}): Job => ({ every, run: noop, ...options } as Job);
const unix = (iso: string) => Date.parse(iso) / 1000;

Deno.test("cron schedules intervals, hours, and zoned daily times", () => {
  assertEquals(nextRun(job(90), 100, "UTC"), 190);
  assertEquals(nextRun(job(90, { jitter: 30 }), 100, "UTC", false, () => 0), 160);
  assert(nextRun(job(90, { jitter: 30 }), 100, "UTC", false, () => 0.999999) < 220);
  assertEquals(nextRun(job("hour"), unix("2026-01-01T12:34:56Z"), "UTC"), unix("2026-01-01T13:00:00Z"));
  assertEquals(
    nextRun(job("day", { at: { hour: 3 } }), unix("2026-01-01T20:00:00Z"), "Europe/Zurich"),
    unix("2026-01-02T02:00:00Z"),
  );
});

Deno.test("cron applies and persists jitter around a daily time", () => {
  const now = unix("2026-01-01T20:00:00Z");
  const daily = job("day", { at: { hour: 3 }, jitter: 2 * 60 * 60 });
  const first = nextRun(daily, now, "Europe/Zurich", false, () => 0);
  const last = nextRun(daily, now, "Europe/Zurich", false, () => 0.999999);
  assertEquals(first, unix("2026-01-02T00:00:00Z"));
  assert(last >= first);
  assert(last < unix("2026-01-02T04:00:00Z"));
});

Deno.test("cron positions jobs within hours and weeks", () => {
  const hourly = job("hour", { at: { minute: 27, second: 30 }, jitter: 5 * 60 + 30 });
  assertEquals(nextRun(hourly, unix("2026-01-01T12:00:00Z"), "UTC", false, () => 0), unix("2026-01-01T12:22:00Z"));
  assert(nextRun(hourly, unix("2026-01-01T12:00:00Z"), "UTC", false, () => 0.999999) < unix("2026-01-01T12:33:00Z"));
  assertEquals(nextRun(hourly, unix("2026-01-01T12:23:00Z"), "UTC", true, () => 0), unix("2026-01-01T13:22:00Z"));

  const sunday = job("week", { at: { weekday: "sunday", hour: 12 }, jitter: 12 * 60 * 60 });
  assertEquals(nextRun(sunday, unix("2026-03-28T12:00:00Z"), "Europe/Zurich", false, () => 0), unix("2026-03-28T23:00:00Z"));
  assert(nextRun(sunday, unix("2026-03-28T12:00:00Z"), "Europe/Zurich", false, () => 0.999999) < unix("2026-03-29T22:00:00Z"));
});

Deno.test("cron rejects invalid schedules", () => {
  const invalid = (value: unknown) => validateJob("test:invalid", value as Job);
  assertThrows(() => invalid({ run: noop }), Error, "every must be");
  assertThrows(() => invalid({ every: "day", at: { minute: 60 }, run: noop }), Error, "at.minute");
  assertThrows(() => invalid({ every: "hour", at: { hour: 3 }, run: noop }), Error, "at.hour");
  assertThrows(() => invalid({ every: 60, jitter: 31, run: noop }), Error, "at most half");
});

Deno.test("cron fingerprints only settings relevant to the cadence", () => {
  assertEquals(scheduleKey(job(60), "UTC"), scheduleKey(job(60), "Europe/Zurich"));
  assertEquals(scheduleKey(job("week"), "UTC"), scheduleKey(job("week", { at: { weekday: "monday" } }), "UTC"));
  assert(scheduleKey(job("day"), "UTC") !== scheduleKey(job("day"), "Europe/Zurich"));
});

Deno.test({
  name: "cron discovers manifest jobs, leases a due run, and stores its result",
  fn: async () => {
    let testRuns = 0, testScheduledAt: number | undefined, testManual: boolean | undefined;
    const cron = {
      refresh: {
        every: 1,
        run(_app: App, { signal, scheduledAt, manual }: { signal: AbortSignal; scheduledAt: number; manual: boolean }) {
          if (signal.aborted) throw signal.reason;
          testRuns++;
          testScheduledAt = scheduledAt;
          testManual = manual;
        },
      },
    } satisfies Record<string, Job>;
    const { app, db, ctrl } = await createTestApp(cron);
    try {
      const initial = await run(app);
      assertEquals(initial.jobs, 1);
      assertEquals(initial.ran, []);
      const manual = await trigger(app, "test.jobs:refresh");
      assertEquals(manual.ran, ["test.jobs:refresh"]);
      assertEquals(manual.due, 0);
      assertEquals(manual.nextRun, initial.nextRun);
      assertEquals(testRuns, 1);
      assertEquals(testManual, true);
      assert(Number(testScheduledAt) < Number(initial.nextRun));

      await app.db.exec`UPDATE cron_job SET next_run = ${0} WHERE id = ${"test.jobs:refresh"}`;

      const [a, b] = await Promise.all([run(app), run(app)]);
      assertEquals(a.ran, ["test.jobs:refresh"]);
      assertEquals(b.ran, ["test.jobs:refresh"]);
      assertEquals(testRuns, 2);
      assertEquals(testScheduledAt, 0);
      assertEquals(testManual, false);

      await app.db.exec`UPDATE cron_job SET next_run = ${0} WHERE id = ${"test.jobs:refresh"}`;
      const ctrlA = new AbortController(), ctrlB = new AbortController();
      const schedulerA = new Scheduler(app), schedulerB = new Scheduler(app);
      await Promise.all([schedulerA.init(ctrlA.signal), schedulerB.init(ctrlB.signal)]);
      const competing = await Promise.all([schedulerA.run(), schedulerB.run()]);
      ctrlA.abort();
      ctrlB.abort();
      assertEquals(testRuns, 3);
      assertEquals(competing.flatMap((v: RunResult) => v.ran), ["test.jobs:refresh"]);

      const rows = await status(app);
      const row = rows.find((v) => v.id === "test.jobs:refresh")!;
      assertEquals(row.active, true);
      assertEquals(row.running, false);
      assertEquals(row.failures, 0);
      assert(Number(row.lastSuccess) > 0);
      assert(row.nextRun > Number(row.lastSuccess));
    } finally {
      ctrl.abort();
      await db.close();
    }
  },
});

Deno.test({
  name: "cron records failures, retries, recovery, and timeouts",
  fn: async () => {
    let behavior: "fail" | "timeout" | "succeed" = "fail";
    const cron = {
      unstable: {
        every: 1,
        timeout: 1,
        run(_app: App, { signal }: { signal: AbortSignal }) {
          if (behavior === "fail") throw new Error("broken");
          if (behavior === "timeout") return new Promise((_, reject) => {
            const keepAlive = setTimeout(noop, 2_000);
            signal.addEventListener("abort", () => {
              clearTimeout(keepAlive);
              reject(signal.reason);
            }, { once: true });
          });
        },
      },
    } satisfies Record<string, Job>;
    const { app, db, ctrl } = await createTestApp(cron);
    const id = "test.jobs:unstable";
    const consoleError = console.error;
    console.error = noop;
    try {
      await run(app);
      await db.exec`UPDATE cron_job SET next_run = ${0} WHERE id = ${id}`;
      const failed = await run(app);
      assertEquals(failed.failed[id], "Error: broken");
      let row = (await status(app)).find((v) => v.id === id)!;
      assertEquals(row.failures, 1);
      assertEquals(row.lastError, "Error: broken");

      behavior = "succeed";
      await db.exec`UPDATE cron_job SET next_run = ${0} WHERE id = ${id}`;
      assertEquals((await run(app)).ran, [id]);
      row = (await status(app)).find((v) => v.id === id)!;
      assertEquals(row.failures, 0);
      assertEquals(row.lastError, undefined);

      behavior = "timeout";
      await db.exec`UPDATE cron_job SET next_run = ${0} WHERE id = ${id}`;
      const timedOut = await run(app);
      assert(timedOut.failed[id].startsWith("TimeoutError:"));
    } finally {
      console.error = consoleError;
      ctrl.abort();
      await db.close();
    }
  },
});

async function createTestApp(cron: Record<string, Job>) {
  const db = new Db("sqlite::memory:");
  await db.query`CREATE TABLE cron_job (
    id TEXT PRIMARY KEY, schedule_key TEXT NOT NULL, next_run INTEGER NOT NULL,
    lock_id TEXT NOT NULL, locked_until INTEGER NOT NULL, last_started INTEGER NOT NULL,
    last_finished INTEGER NOT NULL, last_success INTEGER NOT NULL, duration_ms INTEGER NOT NULL,
    failures INTEGER NOT NULL, last_error TEXT NOT NULL
  )`;
  const plugin = { name: "test.jobs", needs: ["cron"], cron };
  const events = new Emitter<Record<string, Record<string, unknown>>>();
  const app = {
    db,
    settings: { cron: { pollSeconds: 60, timezone: "UTC" } },
    modules: {
      all: () => ({ [plugin.name]: { name: plugin.name, plugin } }),
      linked: (name: string) => name === plugin.name,
    },
    on: events.on.bind(events),
    fire: events.fire.bind(events),
  } as unknown as App;
  const ctrl = new AbortController();
  await init(app, { signal: ctrl.signal });
  return { app, db, ctrl };
}
