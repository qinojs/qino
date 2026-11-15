import { test } from "node:test";
import { assertEquals, assertStringIncludes } from "@qino/qino/tests";

import { ics } from "../mod.ts";

test("calendar writes iCalendar with date and UTC values, escaped text and folded lines", () => {
  const out = ics([
    { id: "7", title: "Course; one, two", start: "2027-07-12", end: "2027-07-14", location: "Hall\nZurich" },
    { id: "8", title: "Evening", start: "2027-07-10T19:00+02:00", end: "2027-07-10T21:00+02:00", url: "https://example.test/e", description: "x".repeat(200) },
    { id: "9", title: "Open end \\ cancelled", start: "2027-07-10T17:00Z", end: "2027-07-10T17:00Z", status: "CANCELLED" },
  ], { host: "example.test", organizer: { name: 'Hall "and" Co', email: "info@example.test" } });
  assertEquals(out.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:"), true);
  assertStringIncludes(out, "UID:7@example.test\r\n");
  assertStringIncludes(out, "DTSTART;VALUE=DATE:20270712\r\nDTEND;VALUE=DATE:20270714\r\n");
  assertStringIncludes(out, "SUMMARY:Course\\; one\\, two\r\n");
  assertStringIncludes(out, "LOCATION:Hall\\nZurich\r\n");
  assertStringIncludes(out, "DTSTART:20270710T170000Z\r\nDTEND:20270710T190000Z\r\n");
  assertStringIncludes(out, "DTSTART:20270710T170000Z\r\nSUMMARY:Open end \\\\ cancelled\r\nSTATUS:CANCELLED\r\n");
  assertStringIncludes(out, 'ORGANIZER;CN="Hall and Co":mailto:info@example.test\r\n');
  assertEquals(ics([{ id: "1", title: "x", start: "2027-07-10", end: "2027-07-11" }], { host: "h", organizer: { name: "No address" } }).includes("ORGANIZER"), false);
  assertEquals(out.split("\r\n").every((line) => new TextEncoder().encode(line).length <= 75), true);
  assertEquals(out.replaceAll("\r\n ", "").includes("x".repeat(200)), true);
});
