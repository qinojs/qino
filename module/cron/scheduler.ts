import { sql, uid, unixTime, type App, type Row } from "../core/mod.ts";
import type { Job, Jobs } from "./mod.ts";
import { nextRun, scheduleKey, validateJob } from "./calendar.ts";

const DEFAULT_TIMEOUT = 15 * 60;
const RETRY_MAX = 60 * 60;
const IDLE = { lock_id: "", locked_until: 0, last_started: 0, last_finished: 0, last_success: 0, duration_ms: 0, failures: 0, last_error: "" };

const schedulers = new WeakMap<App, Scheduler>();

type RegisteredJob = { id: string; job: Job; key: string };
type Result = { ran: string[]; failed: Record<string, string> };

export class Scheduler {
  #app: App;
  #running?: Promise<Result>;
  #timer?: ReturnType<typeof setTimeout>;
  #nextKick = 0;
  #poll = 60_000;
  #signal?: AbortSignal;

  constructor(app: App) { this.#app = app; }

  async init(signal: AbortSignal): Promise<void> {
    this.#signal = signal;
    this.#poll = Math.max(5, Number(await this.#app.settings.cron.pollSeconds)) * 1000;
    Temporal.Now.zonedDateTimeISO(await timezone(this.#app)); // throws on an unknown IANA name
    await this.#load(unixTime()); // fails during boot on a malformed declaration
    schedulers.set(this.#app, this);
    this.#schedule();
    signal.addEventListener("abort", () => {
      clearTimeout(this.#timer);
      if (schedulers.get(this.#app) === this) schedulers.delete(this.#app);
    }, { once: true });
  }

  /** Throttled nudge from incoming requests — never waits for the jobs. */
  kick(): void {
    const now = Date.now();
    if (now < this.#nextKick) return;
    this.#nextKick = now + this.#poll;
    this.run().catch((e) => console.error("cron:", e));
  }

  /** Run every due job. Concurrent calls share one run. */
  run(): Promise<Result> {
    return this.#running ??= this.#tick().finally(() => { this.#running = undefined; });
  }

  /** Run one job now, without consuming a scheduled slot that is still ahead. */
  async trigger(id: string): Promise<Result> {
    const now = unixTime();
    const { jobs, rows, timeZone } = await this.#load(now);
    const registered = jobs.find((v) => v.id === id);
    if (!registered) throw new Error(`Unknown cron job "${id}"`);
    const result: Result = { ran: [], failed: {} };
    if (!await this.#runJob(registered, rows.get(id)!, result, { timeZone, force: true })) throw new Error(`Cron job "${id}" is already running`);
    return result;
  }

  /** Persisted state of every job, including rows left behind by unlinked modules. */
  async status() {
    const now = unixTime();
    const { jobs, rows } = await this.#load(now);
    const active = new Map(jobs.map((v) => [v.id, v.job]));
    return [...rows.values()].sort((a, b) => String(a.id).localeCompare(String(b.id))).map((row) => {
      const job = active.get(String(row.id));
      return {
        id: String(row.id),
        active: !!job,
        every: job?.every,
        at: job?.at,
        jitter: job?.jitter,
        timeout: job && (job.timeout ?? DEFAULT_TIMEOUT),
        nextRun: Number(row.next_run),
        running: Number(row.locked_until) > now,
        lastStarted: Number(row.last_started) || undefined,
        lastFinished: Number(row.last_finished) || undefined,
        lastSuccess: Number(row.last_success) || undefined,
        durationMs: Number(row.last_finished) ? Number(row.duration_ms) : undefined,
        failures: Number(row.failures),
        lastError: String(row.last_error || "") || undefined,
      };
    });
  }

  #schedule(): void {
    const timer = setTimeout(async () => {
      await this.run().catch((e) => console.error("cron:", e));
      if (!this.#signal?.aborted) this.#schedule();
    }, this.#poll);
    this.#timer = timer;
    Deno.unrefTimer(timer);
  }

  /** Declared jobs plus their persisted rows; seeds new jobs and reschedules changed ones. */
  async #load(now: number): Promise<{ jobs: RegisteredJob[]; rows: Map<string, Row>; timeZone: string }> {
    const db = this.#app.db;
    const timeZone = await timezone(this.#app);
    const jobs = collect(this.#app, timeZone);
    const rows = new Map((await db.query`SELECT * FROM cron_job`).map((row) => [String(row.id), row]));
    for (const { id, job, key } of jobs) {
      const row = rows.get(id);
      if (row && row.schedule_key === key) continue;
      const next_run = nextRun(job, now, { timeZone });
      if (!row) {
        const fresh = { ...IDLE, id, schedule_key: key, next_run };
        await db.table("cron_job").insert(fresh).catch(() => {}); // a competing process may have seeded it first
        rows.set(id, fresh);
      } else {
        await db.exec`
          UPDATE cron_job SET schedule_key = ${key}, next_run = ${next_run}, lock_id = ${""}, locked_until = ${0}
          WHERE id = ${id} AND schedule_key = ${row.schedule_key} AND locked_until <= ${now}`;
        Object.assign(row, { schedule_key: key, next_run, locked_until: 0 });
      }
    }
    return { jobs, rows, timeZone };
  }

  async #tick(): Promise<Result> {
    const now = unixTime();
    const { jobs, rows, timeZone } = await this.#load(now);
    const result: Result = { ran: [], failed: {} };
    const due = jobs.filter((v) => Number(rows.get(v.id)!.next_run) <= now);
    await Promise.all(due.map((v) => this.#runJob(v, rows.get(v.id)!, result, { timeZone })));
    return result;
  }

  /** Claims the lease, runs the job, writes the outcome back. False = another process holds it. */
  async #runJob(registered: RegisteredJob, row: Row, result: Result, o: { timeZone: string; force?: boolean }): Promise<boolean> {
    const db = this.#app.db;
    const { id, job } = registered;
    const now = unixTime();
    const timeout = job.timeout ?? DEFAULT_TIMEOUT;
    const lock = uid(22);
    const claimed = await db.exec`
      UPDATE cron_job
      SET lock_id = ${lock}, locked_until = ${now + timeout + 60}, last_started = ${now}
      WHERE id = ${id} AND locked_until <= ${now} AND (${o.force ?? false} OR next_run <= ${now})`;
    if (!claimed.affectedRows) return false;

    // A forced run of a job that is not due yet must not consume its scheduled slot.
    const keepSlot = o.force && Number(row.next_run) > now ? Number(row.next_run) : 0;
    const started = performance.now();
    const ctrl = new AbortController();
    const signal = this.#signal ? AbortSignal.any([this.#signal, ctrl.signal]) : ctrl.signal;
    const timer = setTimeout(() => ctrl.abort(new DOMException(`Cron job timed out after ${timeout} seconds`, "TimeoutError")), timeout * 1000);
    Deno.unrefTimer(timer);

    let failure: string | undefined;
    try {
      await Promise.race([
        job.run(this.#app, { signal }),
        new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
      ]);
    } catch (e) {
      // Shutdown is not a job failure: drop the lease and leave the schedule alone.
      if (this.#signal?.aborted) {
        await db.exec`UPDATE cron_job SET lock_id = ${""}, locked_until = ${0} WHERE id = ${id} AND lock_id = ${lock}`;
        return true;
      }
      failure = (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 65535); // fits last_error
      console.error(`cron job "${id}":`, e);
    } finally {
      clearTimeout(timer);
    }

    const finished = unixTime();
    const failures = failure ? Number(row.failures ?? 0) + 1 : 0;
    const next = failure
      ? finished + Math.min(2 ** Math.min(failures - 1, 10) * 60, RETRY_MAX)
      : nextRun(job, finished, { timeZone: o.timeZone, nextPeriod: true });
    await db.exec`
      UPDATE cron_job
      SET next_run = ${keepSlot || next}, lock_id = ${""}, locked_until = ${0}, last_finished = ${finished},
        last_success = ${failure ? sql.raw("last_success") : finished},
        duration_ms = ${Math.round(performance.now() - started)}, failures = ${failures}, last_error = ${failure ?? ""}
      WHERE id = ${id} AND lock_id = ${lock}`;
    if (failure) result.failed[id] = failure;
    else result.ran.push(id);
    return true;
  }
}

function of(app: App): Scheduler {
  const scheduler = schedulers.get(app);
  if (!scheduler) throw new Error('Module "cron" is not linked');
  return scheduler;
}

/** Run every due job. Concurrent calls on the same App share one run. */
export function run(app: App): Promise<Result> { return of(app).run(); }

/** Run one job now, without consuming a scheduled slot that is still ahead. */
export function trigger(app: App, id: string): Promise<Result> { return of(app).trigger(id); }

/** Persisted state of every job, including rows left behind by unlinked modules. */
export function status(app: App): ReturnType<Scheduler["status"]> { return of(app).status(); }

/** Jobs declared by linked modules, sorted by id. */
function collect(app: App, timeZone: string): RegisteredJob[] {
  const ret: RegisteredJob[] = [];
  for (const mod of Object.values(app.modules.all()).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!app.modules.linked(mod.name)) continue;
    const declared = mod.plugin.cron as Jobs | undefined;
    if (declared == null) continue;
    if (typeof declared !== "object" || Array.isArray(declared)) throw new Error(`Module "${mod.name}": cron must be an object`);
    if (!(mod.plugin.needs ?? []).includes("cron")) throw new Error(`Module "${mod.name}": needs must include "cron" when declaring cron jobs`);
    for (const name of Object.keys(declared).sort()) {
      if (!/^[a-zA-Z0-9._-]+$/.test(name)) throw new Error(`Module "${mod.name}": invalid cron job name "${name}"`);
      const job = declared[name];
      const id = `${mod.name}:${name}`;
      validateJob(id, job);
      ret.push({ id, job, key: scheduleKey(job, timeZone) });
    }
  }
  return ret;
}

async function timezone(app: App): Promise<string> {
  return String(await app.settings.cron.timezone);
}
