import { test } from "node:test";
import { assertEquals, assertThrows } from "@qino/qino/tests";

import { occurrences } from "../mod.ts";

const period = { start: "2027-03-01", end: "2027-05-01", timeZone: "Europe/Zurich" };

test("calendar recurrence keeps weekly wall times across DST, and applies RDATE and EXDATE", () => {
  const result = occurrences({
    start: "2027-03-22T09:00+01:00", end: "2027-03-22T11:00+01:00", timeZone: "Europe/Zurich",
    rrule: "FREQ=WEEKLY;BYDAY=MO;COUNT=3", exdate: ["2027-03-29T09:00+02:00"],
    rdate: ["2027-04-07T09:00+02:00"],
  }, period);
  assertEquals(result.map((item) => item.start), ["2027-03-22T08:00:00.000000000Z", "2027-04-05T07:00:00.000000000Z", "2027-04-07T07:00:00.000000000Z"]);
  assertEquals(result.every((item) => item.recurrenceId === item.start), true);
});

test("calendar recurrence skips invalid month dates and preserves multi-day all-day events", () => {
  const result = occurrences({ start: "2027-01-31", end: "2027-02-02", rrule: "FREQ=MONTHLY;COUNT=3" }, {
    start: "2027-02-01", end: "2027-04-01", timeZone: "Europe/Zurich",
  });
  assertEquals(result, [
    { start: "2027-01-31", end: "2027-02-02", recurrenceId: "2027-01-31" },
    { start: "2027-03-31", end: "2027-04-02", recurrenceId: "2027-03-31" },
  ]);
  assertEquals(occurrences({ start: "2027-03-01", end: "2027-03-02", rrule: "FREQ=DAILY;UNTIL=20270303" }, period).length, 3);
});

test("calendar recurrence includes spanning instances and excludes adjacent boundaries", () => {
  const schedule = { start: "2027-03-01T15:00Z", end: "2027-03-02T09:00Z", timeZone: "UTC", rrule: "FREQ=DAILY" };
  const result = occurrences(schedule, { start: "2027-03-12T08:00Z", end: "2027-03-12T15:00Z", timeZone: "UTC" });
  assertEquals(result.map((item) => item.start), ["2027-03-11T15:00:00.000000000Z"]);
  assertThrows(() => occurrences({ ...schedule, timeZone: undefined }, period), RangeError);
  assertThrows(() => occurrences({ ...schedule, rrule: "FREQ=INVALID" }, period));
});

test("calendar recurrence skips nonexistent local times without consuming count and bounds generation work", () => {
  const result = occurrences({
    start: "2027-03-21T02:30+01:00", end: "2027-03-21T03:30+01:00", timeZone: "Europe/Zurich",
    rrule: "FREQ=WEEKLY;BYDAY=SU;COUNT=3",
  }, period);
  assertEquals(result.map((item) => item.start.slice(0, 10)), ["2027-03-21", "2027-04-04", "2027-04-11"]);
  assertThrows(() => occurrences({
    start: "2027-03-01T00:00Z", end: "2027-03-01T00:00:01Z", timeZone: "UTC", rrule: "FREQ=SECONDLY",
  }, period));
});
