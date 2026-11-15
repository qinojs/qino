import { test } from "node:test";
import { assertEquals } from "@qino/qino/tests";

import { range } from "./plugin.ts";

const ZONE = "Europe/Paris";

test("event2 dates become blocks: whole days as dates, times in the PHP zone, a missing end a moment", () => {
  const date = (start_date: string, end_date: string, all_day = 0) => range({ start_date, end_date, all_day }, ZONE);
  // all-day dates end on their last day in PHP
  assertEquals(date("2020-03-11 10:00:00", "2020-03-14 17:30:00", 1), { start: "2020-03-11", end: "2020-03-15" });
  // midnight to midnight: already the exclusive end; the same midnight twice is one day
  assertEquals(date("2027-01-23 00:00:00", "2027-01-24 00:00:00"), { start: "2027-01-23", end: "2027-01-24" });
  assertEquals(date("2027-01-23 00:00:00", "2027-01-23 00:00:00"), { start: "2027-01-23", end: "2027-01-24" });
  // summer and winter time of the zone
  assertEquals(date("2027-07-10 09:00:00", "2027-07-10 11:00:00"), { start: "2027-07-10T07:00:00Z", end: "2027-07-10T09:00:00Z" });
  assertEquals(date("2027-01-10 09:00:00", "2027-01-10 11:00:00"), { start: "2027-01-10T08:00:00Z", end: "2027-01-10T10:00:00Z" });
  // an end before the start: none given
  assertEquals(date("2026-06-09 19:00:00", "2026-06-09 00:00:00"), { start: "2026-06-09T17:00:00Z", end: "2026-06-09T17:00:00Z" });
  // a prepared MySQL database holds Unix time
  assertEquals(range({ start_date: 1783666800, end_date: 1783674000, all_day: 0 }, ZONE), { start: "2026-07-10T07:00:00Z", end: "2026-07-10T09:00:00Z" });
});
