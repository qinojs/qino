import { test } from "node:test";
import { assertEquals, assertRejects, testContext } from "@qino/qino/tests";

import { entries, sources } from "../mod.ts";

import type { Period } from "../mod.ts";

const period = { start: "2027-07-12", end: "2027-07-13", timeZone: "Europe/Zurich" };

test("calendar queries linked sources with exact bounds and source-qualified identities", async () => {
  const seen: Period[] = [];
  const item = { id: "1", title: "One day", start: "2027-07-12", end: "2027-07-13" };
  const ctx = await testContext({ app: { modules: { linked: () => [
    { name: "one", plugin: { calendar: { color: "green", query: (_: unknown, range: Period) => { seen.push(range); return [item]; } } } },
    { name: "two", plugin: { calendar: { query: () => [item, { ...item, id: "outside", start: "2027-07-13", end: "2027-07-14" }] } } },
    { name: "unrelated", plugin: {} },
  ] } } });
  assertEquals((await entries(ctx, period)).map(({ source, id }) => [source, id]), [["one", "1"], ["two", "1"]]);
  assertEquals(seen, [{ start: "2027-07-11T22:00:00Z", end: "2027-07-12T22:00:00Z", timeZone: period.timeZone }]);
  assertEquals(await entries(ctx, { ...period, sources: [] }), []);
  assertEquals((await entries(ctx, { ...period, sources: ["two"] })).map((item) => item.source), ["two"]);
  assertEquals(seen.length, 1);
  assertEquals(sources(ctx.app, "de").map((source) => source.id), ["one", "two"]);
  assertEquals(sources(ctx.app, "de").map((source) => source.color), ["green", undefined]);
});

test("calendar sources remain tenant-local and errors are not mistaken for empty calendars", async () => {
  const empty = await testContext();
  assertEquals(await entries(empty, period), []);
  const broken = await testContext({ app: { modules: { linked: () => [
    { name: "broken", plugin: { calendar: { query: () => { throw new Error("Source unavailable"); } } } },
  ] } } });
  await assertRejects(() => entries(broken, period), Error, "Source unavailable");
  assertEquals(await entries(empty, period), []);
});
