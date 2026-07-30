import type { Job, Weekday } from "./types.ts";

const PERIODS = { hour: 60 * 60, day: 24 * 60 * 60, week: 7 * 24 * 60 * 60 } as const;
const WEEKDAYS: readonly Weekday[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

export function validateJob(id: string, job: Job): void {
  if (!job || typeof job !== "object" || typeof job.run !== "function") throw new Error(`Cron job "${id}" needs a run function`);
  const every = job.every;
  if (typeof every === "number") {
    if (!Number.isInteger(every) || every < 1) throw new Error(`Cron job "${id}": numeric every must be a positive whole number of seconds`);
  } else if (every !== "hour" && every !== "day" && every !== "week") throw new Error(`Cron job "${id}": every must be "hour", "day", "week", or seconds`);
  validateAt(id, job);
  const period = typeof every === "number" ? every : PERIODS[every];
  if (job.jitter != null && (!Number.isInteger(job.jitter) || job.jitter < 0 || job.jitter > period / 2))
    throw new Error(`Cron job "${id}": jitter must be whole seconds, non-negative, and at most half of every`);
  if (job.timeout != null && (!Number.isInteger(job.timeout) || job.timeout < 1)) throw new Error(`Cron job "${id}": timeout must be a positive whole number of seconds`);
}

/** Fingerprint of everything that moves a job's slot — a change reschedules it. */
export function scheduleKey(job: Job, timeZone: string): string {
  const at = job.at;
  if (typeof job.every === "number") return JSON.stringify([job.every, job.jitter ?? 0]);
  if (job.every === "hour") return JSON.stringify([job.every, at?.minute ?? 0, at?.second ?? 0, job.jitter ?? 0, timeZone]);
  if (job.every === "day") return JSON.stringify([job.every, at?.hour ?? 0, at?.minute ?? 0, at?.second ?? 0, job.jitter ?? 0, timeZone]);
  return JSON.stringify([job.every, at?.weekday ?? "monday", at?.hour ?? 0, at?.minute ?? 0, at?.second ?? 0, job.jitter ?? 0, timeZone]);
}

/** Next epoch second for a job. `nextPeriod` skips the current slot, after a run has just finished. */
export function nextRun(job: Job, now: number, o: { timeZone: string; nextPeriod?: boolean; random?: () => number }): number {
  const random = o.random ?? Math.random;
  const jitter = job.jitter ?? 0;
  if (typeof job.every === "number") return randomBetween(now + job.every - jitter, now + job.every + jitter, now, random);
  const zoned = Temporal.Instant.fromEpochMilliseconds(now * 1000).toZonedDateTimeISO(o.timeZone);
  const at = job.at ?? {};
  let target: Temporal.ZonedDateTime;
  let advance: Temporal.DurationLike;
  if (job.every === "hour") {
    target = zoned.with({ minute: at.minute ?? 0, second: at.second ?? 0, millisecond: 0, microsecond: 0, nanosecond: 0 });
    advance = { hours: 1 };
  } else if (job.every === "day") {
    target = withTime(zoned.startOfDay(), at);
    advance = { days: 1 };
  } else {
    const weekday = WEEKDAYS.indexOf(at.weekday ?? "monday") + 1;
    const monday = zoned.startOfDay().subtract({ days: zoned.dayOfWeek - 1 });
    target = withTime(monday.add({ days: weekday - 1 }), at);
    advance = { weeks: 1 };
  }
  if (o.nextPeriod) target = target.add(advance);
  let range = window(target, jitter, o.timeZone);
  if (range.end <= now + 1) range = window(target.add(advance), jitter, o.timeZone);
  return randomBetween(range.start, range.end, now, random);
}

function validateAt(id: string, job: Job): void {
  const at = job.at;
  if (at == null) return;
  if (typeof job.every === "number") throw new Error(`Cron job "${id}": at is only valid with calendar periods`);
  if (!at || typeof at !== "object" || Array.isArray(at)) throw new Error(`Cron job "${id}": at must be an object`);
  const allowed = job.every === "hour" ? new Set(["minute", "second"])
    : job.every === "day" ? new Set(["hour", "minute", "second"])
    : new Set(["weekday", "hour", "minute", "second"]);
  for (const key of Object.keys(at)) if (!allowed.has(key)) throw new Error(`Cron job "${id}": at.${key} is not valid with every: "${job.every}"`);
  if (at.weekday != null && !WEEKDAYS.includes(at.weekday)) throw new Error(`Cron job "${id}": invalid weekday "${at.weekday}"`);
  for (const [name, value, max] of [["hour", at.hour, 23], ["minute", at.minute, 59], ["second", at.second, 59]] as const)
    if (value != null && (!Number.isInteger(value) || value < 0 || value > max)) throw new Error(`Cron job "${id}": at.${name} must be between 0 and ${max}`);
}

function randomBetween(start: number, end: number, now: number, random: () => number): number {
  start = Math.max(start, now + 1);
  return start + Math.floor(random() * Math.max(1, end - start));
}

function withTime(day: Temporal.ZonedDateTime, at: NonNullable<Job["at"]>): Temporal.ZonedDateTime {
  return day.with({ hour: at.hour ?? 0, minute: at.minute ?? 0, second: at.second ?? 0, millisecond: 0, microsecond: 0, nanosecond: 0 });
}

function window(at: Temporal.ZonedDateTime, jitter: number, timeZone: string): { start: number; end: number } {
  const plain = at.toPlainDateTime();
  const epoch = (time: Temporal.PlainDateTime) => Math.floor(time.toZonedDateTime(timeZone).epochMilliseconds / 1000);
  return { start: epoch(plain.subtract({ seconds: jitter })), end: epoch(plain.add({ seconds: jitter })) };
}
