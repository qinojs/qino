import { test } from "node:test";
import { assertEquals, assertThrows } from "@qino/qino/tests";

import { overlaps } from "../mod.ts";

const zurich = { timeZone: "Europe/Zurich" };

test("calendar ranges overlap across midnight and include entries spanning the query", () => {
  const booking = { start: "2027-07-10T15:00+02:00", end: "2027-07-13T09:00+02:00" };
  const query = { start: "2027-07-12T00:00+02:00", end: "2027-07-13T00:00+02:00" };
  assertEquals(overlaps(booking, query), true);
  assertEquals(overlaps(query, booking), true);
  assertEquals(overlaps(booking, { start: booking.end, end: "2027-07-14T09:00+02:00" }), false);
});

test("calendar compares all-day ranges as dates with exclusive ends", () => {
  const holiday = { start: "2027-07-10", end: "2027-07-16" };
  assertEquals(overlaps(holiday, { start: "2027-07-15", end: "2027-07-16" }), true);
  assertEquals(overlaps(holiday, { start: "2027-07-16", end: "2027-07-17" }), false);
});

test("calendar projects whole days into an explicit zone across both clock changes", () => {
  for (const [start, end] of [["2027-03-28", "2027-03-29"], ["2027-10-31", "2027-11-01"]]) {
    const day = { start, end };
    const midnight = Temporal.PlainDate.from(end).toZonedDateTime(zurich.timeZone);
    const last = { start: midnight.subtract({ minutes: 1 }).toString(), end: midnight.toString() };
    const next = { start: midnight.toString(), end: midnight.add({ minutes: 1 }).toString() };
    assertEquals(overlaps(day, last, zurich), true);
    assertEquals(overlaps(day, next, zurich), false);
    assertEquals(overlaps(last, day, zurich), true);
  }
});

test("calendar uses the first valid time when a clock change skips midnight", () => {
  const day = { start: "2015-10-18", end: "2015-10-19" };
  const before = { start: "2015-10-18T02:59Z", end: "2015-10-18T03:00Z" };
  const after = { start: "2015-10-18T03:00Z", end: "2015-10-18T03:01Z" };
  assertEquals(overlaps(day, before, { timeZone: "America/Sao_Paulo" }), false);
  assertEquals(overlaps(day, after, { timeZone: "America/Sao_Paulo" }), true);
});

test("calendar compares instants across different offsets and validates named zones", () => {
  const booking = { start: "2027-07-10T15:00+02:00[Europe/Zurich]", end: "2027-07-11T09:00+02:00[Europe/Zurich]" };
  assertEquals(overlaps(booking, { start: "2027-07-11T06:59Z", end: "2027-07-11T07:00Z" }), true);
  assertEquals(overlaps(booking, { start: "2027-07-11T07:00Z", end: "2027-07-11T08:00Z" }), false);
  assertThrows(() => overlaps({ ...booking, start: "2027-07-10T15:00+01:00[Europe/Zurich]" }, booking), RangeError);
});

test("calendar dates skipped by a time zone have no overlap with instants", () => {
  const skipped = { start: "2011-12-30", end: "2011-12-31" };
  const query = { start: "2011-12-29T00:00Z", end: "2012-01-01T00:00Z" };
  assertEquals(overlaps(skipped, query, { timeZone: "Pacific/Apia" }), false);
});

test("calendar rejects ambiguous, invalid and empty ranges instead of guessing", () => {
  const day = { start: "2027-07-10", end: "2027-07-11" };
  const timed = { start: "2027-07-10T09:00Z", end: "2027-07-10T11:00Z" };
  assertThrows(() => overlaps(day, timed), RangeError, "requires a time zone");
  for (const range of [
    { start: "2027-02-30", end: "2027-03-01" },
    { start: day.start, end: day.start },
    { start: day.end, end: day.start },
    { start: day.start, end: timed.end },
    { start: timed.start, end: day.end },
    { start: "2027-07-10T09:00", end: "2027-07-10T11:00" },
    { start: timed.end, end: timed.start },
    { start: timed.start, end: timed.start },
  ]) assertThrows(() => overlaps(range, day, zurich), RangeError);
});
