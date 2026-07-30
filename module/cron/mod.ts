import type { App } from "../core/mod.ts";

export type Every = "hour" | "day" | "week" | number;
export type Weekday = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

export type Job = {
  run(app: App, ctx: { signal: AbortSignal }): unknown | Promise<unknown>;
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

export { run, status, trigger } from "./scheduler.ts";
