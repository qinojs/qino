import type { App } from "../core/mod.ts";
import { requestRun, requestTrigger, readStatus } from "./scheduler.ts";

export type Every = "hour" | "day" | "week" | number;
export type Weekday = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

export type Job = {
  run(app: App, ctx: { signal: AbortSignal; scheduledAt: number; manual: boolean }): unknown | Promise<unknown>;
  /** Named period or interval in seconds. */
  every: Every;
  /** Position within a calendar period. */
  at?: { weekday?: Weekday; hour?: number; minute?: number; second?: number };
  /** Maximum random deviation before or after the scheduled time, in seconds. */
  jitter?: number;
  /** Maximum run time in seconds. */
  timeout?: number;
};

export type Jobs = Record<string, Job>;

export type RunResult = {
  jobs: number;
  due: number;
  ran: string[];
  failed: Record<string, string>;
  nextRun?: number;
};

export type JobStatus = {
  id: string;
  active: boolean;
  every?: Every;
  at?: Job["at"];
  jitter?: number;
  timeout?: number;
  nextRun: number;
  running: boolean;
  lastStarted?: number;
  lastFinished?: number;
  lastSuccess?: number;
  durationMs?: number;
  failures: number;
  lastError?: string;
};

/** Run all due jobs. Concurrent calls on the same App share one run. */
export function run(app: App): Promise<RunResult> { return requestRun(app); }

/** Run one job now without moving a future scheduled run. */
export function trigger(app: App, id: string): Promise<RunResult> { return requestTrigger(app, id); }

/** Current persisted state, including inactive jobs retained for diagnostics. */
export function status(app: App): Promise<JobStatus[]> { return readStatus(app); }
