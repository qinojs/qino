import { sql, uid, unixTime, type App } from "../core/mod.ts";
import type { Job, Jobs, JobStatus, RunResult } from "./mod.ts";
import { nextRun, scheduleKey, validateJob } from "./schedule.ts";

const DEFAULT_TIMEOUT = 15 * 60;
const RETRY_MAX = 60 * 60;

type RegisteredJob = { id: string; job: Job; scheduleKey: string };

export class Scheduler {
  #app: App;
  #running?: Promise<RunResult>;
  #timer?: ReturnType<typeof setTimeout>;
  #nextKick = 0;
  #poll = 60_000;
  #signal?: AbortSignal;

  constructor(app: App) { this.#app = app; }

  async init(signal: AbortSignal): Promise<void> {
    this.#signal = signal;
    this.#poll = Math.max(5_000, Number(await this.#app.settings.cron.pollSeconds || 60) * 1000);
    collectJobs(this.#app, await timezone(this.#app), false); // fail during boot on malformed declarations
    this.#schedule();
    signal.addEventListener("abort", () => clearTimeout(this.#timer), { once: true });
  }

  kick(): void {
    const now = Date.now();
    if (now < this.#nextKick) return;
    this.#nextKick = now + this.#poll;
    this.run().catch((e) => console.error("cron:", e));
  }

  run(): Promise<RunResult> {
    return this.#running ??= this.#tick().finally(() => { this.#running = undefined; });
  }

  #schedule(): void {
    const timer = setTimeout(async () => {
      await this.run().catch((e) => console.error("cron:", e));
      if (!this.#signal?.aborted) this.#schedule();
    }, this.#poll);
    this.#timer = timer;
    Deno.unrefTimer(timer);
  }

  async #tick(): Promise<RunResult> {
    const app = this.#app;
    const timeZone = await timezone(app);
    const registered = collectJobs(app, timeZone);
    const now = unixTime();
    await syncRows(app, registered, now, timeZone);

    const active = new Map(registered.map((v) => [v.id, v]));
    const rows = await app.db.query`
      SELECT * FROM cron_job
      WHERE next_run <= ${now}
      ORDER BY next_run, id`;
    const result: RunResult = { jobs: registered.length, due: 0, ran: [], failed: {} };

    for (const row of rows) {
      const registeredJob = active.get(String(row.id));
      if (!registeredJob) continue;
      result.due++;
      await this.#runJob(registeredJob, row, result, { timeZone });
    }

    if (registered.length) {
      result.nextRun = Number(await app.db.one`
        SELECT MIN(next_run) FROM cron_job
        WHERE id IN (${sql.join(registered.map((v) => sql`${v.id}`))})` ?? 0) || undefined;
    }
    return result;
  }

  async trigger(id: string): Promise<RunResult> {
    const app = this.#app;
    const timeZone = await timezone(app);
    const registered = collectJobs(app, timeZone);
    const target = registered.find((v) => v.id === id);
    if (!target) throw new Error(`Unknown cron job "${id}"`);
    const now = unixTime();
    await syncRows(app, registered, now, timeZone);
    const row = await app.db.row`SELECT * FROM cron_job WHERE id = ${id}`;
    if (!row) throw new Error(`Cron job "${id}" has no persisted state`);
    const result: RunResult = { jobs: 1, due: Number(row.next_run) <= now ? 1 : 0, ran: [], failed: {} };
    if (!await this.#runJob(target, row, result, { timeZone, force: true })) throw new Error(`Cron job "${id}" is already running`);
    result.nextRun = Number(await app.db.one`SELECT next_run FROM cron_job WHERE id = ${id}`) || undefined;
    return result;
  }

  async #runJob(registered: RegisteredJob, row: Record<string, unknown>, result: RunResult, options: { timeZone: string; force?: boolean }): Promise<boolean> {
    const { timeZone, force = false } = options;
    const now = unixTime();
    const timeout = registered.job.timeout ?? DEFAULT_TIMEOUT;
    const lock = uid(22);
    const leaseUntil = now + timeout + 60;
    const due = force ? sql.raw("true") : sql`next_run <= ${now}`;
    const claimed = await this.#app.db.exec`
      UPDATE cron_job
      SET lock_id = ${lock}, locked_until = ${leaseUntil}, last_started = ${now}
      WHERE id = ${registered.id} AND ${due} AND locked_until <= ${now}`;
    if (!claimed.affectedRows) return false;

    const preserveSchedule = force && Number(row.next_run) > now;
    const started = performance.now();
    const ctrl = new AbortController();
    const signal = this.#signal ? AbortSignal.any([this.#signal, ctrl.signal]) : ctrl.signal;
    const timer = setTimeout(() => ctrl.abort(new DOMException(`Cron job timed out after ${timeout} seconds`, "TimeoutError")), timeout * 1000);
    Deno.unrefTimer(timer);

    try {
      await Promise.race([
        registered.job.run(this.#app, { signal, scheduledAt: force ? now : Number(row.next_run), manual: force }),
        new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
      ]);
      const finished = unixTime();
      const next = preserveSchedule ? Number(row.next_run) : nextRun(registered.job, finished, timeZone, true);
      await this.#app.db.exec`
        UPDATE cron_job
        SET next_run = ${next}, lock_id = ${""}, locked_until = ${0}, last_finished = ${finished},
          last_success = ${finished}, duration_ms = ${Math.round(performance.now() - started)}, failures = ${0}, last_error = ${""}
        WHERE id = ${registered.id} AND lock_id = ${lock}`;
      result.ran.push(registered.id);
    } catch (e) {
      const message = errorMessage(e);
      const failures = Number(row.failures ?? 0) + 1;
      const finished = unixTime();
      const retry = Math.min(2 ** Math.min(failures - 1, 10) * 60, RETRY_MAX);
      const next = preserveSchedule ? Number(row.next_run) : finished + retry;
      await this.#app.db.exec`
        UPDATE cron_job
        SET next_run = ${next}, lock_id = ${""}, locked_until = ${0}, last_finished = ${finished},
          duration_ms = ${Math.round(performance.now() - started)}, failures = ${failures}, last_error = ${message}
        WHERE id = ${registered.id} AND lock_id = ${lock}`;
      result.failed[registered.id] = message;
      console.error(`cron job "${registered.id}":`, e);
    } finally {
      clearTimeout(timer);
    }
    return true;
  }
}

export async function requestRun(app: App): Promise<RunResult> {
  const event = await app.fire("cron:run", {}) as { result?: RunResult };
  if (!event.result) throw new Error('Module "cron" is not linked');
  return event.result;
}

export async function requestTrigger(app: App, id: string): Promise<RunResult> {
  const event = await app.fire("cron:trigger", { id }) as { id: string; result?: RunResult };
  if (!event.result) throw new Error('Module "cron" is not linked');
  return event.result;
}

export async function readStatus(app: App): Promise<JobStatus[]> {
  const timeZone = await timezone(app);
  const registered = collectJobs(app, timeZone);
  const now = unixTime();
  await syncRows(app, registered, now, timeZone);
  const rows = await app.db.query`SELECT * FROM cron_job ORDER BY id`;
  const active = new Map(registered.map((v) => [v.id, v.job]));
  return rows.map((row) => {
    const job = active.get(String(row.id));
    return {
      id: String(row.id),
      active: !!job,
      every: job?.every,
      at: job?.at,
      jitter: job ? job.jitter ?? 0 : undefined,
      timeout: job ? job.timeout ?? DEFAULT_TIMEOUT : undefined,
      nextRun: Number(row.next_run),
      running: Number(row.locked_until) > now,
      lastStarted: optionalNumber(row.last_started),
      lastFinished: optionalNumber(row.last_finished),
      lastSuccess: optionalNumber(row.last_success),
      durationMs: Number(row.last_finished) ? Number(row.duration_ms) : undefined,
      failures: Number(row.failures),
      lastError: String(row.last_error || "") || undefined,
    };
  });
}

function collectJobs(app: App, timeZone: string, linkedOnly = true): RegisteredJob[] {
  const ret: RegisteredJob[] = [];
  for (const mod of Object.values(app.modules.all()).sort((a, b) => a.name.localeCompare(b.name))) {
    if (linkedOnly && !app.modules.linked(mod.name)) continue;
    const declared = mod.plugin.cron as Jobs | undefined;
    if (declared == null) continue;
    if (!declared || typeof declared !== "object" || Array.isArray(declared)) throw new Error(`Module "${mod.name}": cron must be an object`);
    if (!(mod.plugin.needs ?? []).includes("cron")) throw new Error(`Module "${mod.name}": needs must include "cron" when declaring cron jobs`);
    for (const name of Object.keys(declared).sort()) {
      if (!/^[a-zA-Z0-9._-]+$/.test(name)) throw new Error(`Module "${mod.name}": invalid cron job name "${name}"`);
      const job = declared[name];
      validateJob(`${mod.name}:${name}`, job);
      ret.push({
        id: `${mod.name}:${name}`,
        job,
        scheduleKey: scheduleKey(job, timeZone),
      });
    }
  }
  return ret;
}

async function syncRows(app: App, registeredJobs: RegisteredJob[], now: number, timeZone: string): Promise<void> {
  if (!registeredJobs.length) return;
  const rows = new Map((await app.db.query`SELECT id, schedule_key FROM cron_job`).map((row) => [String(row.id), row]));
  for (const registered of registeredJobs) {
    const row = rows.get(registered.id);
    if (!row) {
      const next = nextRun(registered.job, now, timeZone);
      const prefix = app.db.dialect === "mysql" ? "INSERT IGNORE" : app.db.dialect === "sqlite" ? "INSERT OR IGNORE" : "INSERT";
      const suffix = app.db.dialect === "postgres" ? "ON CONFLICT (id) DO NOTHING" : "";
      await app.db.exec(sql`
        ${sql.raw(prefix)} INTO cron_job
          (id, schedule_key, next_run, lock_id, locked_until, last_started, last_finished, last_success, duration_ms, failures, last_error)
        VALUES (${registered.id}, ${registered.scheduleKey}, ${next}, ${""}, ${0}, ${0}, ${0}, ${0}, ${0}, ${0}, ${""})
        ${sql.raw(suffix)}`);
    } else if (row.schedule_key !== registered.scheduleKey) {
      const next = nextRun(registered.job, now, timeZone);
      await app.db.exec`
        UPDATE cron_job SET schedule_key = ${registered.scheduleKey}, next_run = ${next}, lock_id = ${""}, locked_until = ${0}
        WHERE id = ${registered.id} AND schedule_key = ${row.schedule_key} AND locked_until <= ${now}`;
    }
  }
}

async function timezone(app: App): Promise<string> {
  const value = String(await app.settings.cron.timezone || "UTC");
  try { Temporal.Now.zonedDateTimeISO(value); }
  catch { throw new Error(`Invalid cron timezone "${value}"`); }
  return value;
}

function errorMessage(e: unknown): string {
  return (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 65535);
}

function optionalNumber(value: unknown): number | undefined {
  return Number(value) || undefined;
}
