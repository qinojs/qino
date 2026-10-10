import { assertEquals } from "@qino/qino/tests";

import { history, record } from "../lib/history.ts";

import type { App } from "@qino/qino";

Deno.test("sandbox.flow history: the latest runs, newest first, per app and flow; filtered ones counted", () => {
  const app = {} as App, other = {} as App;
  const run = (end: string, calls = 1) => ({ end, calls: Array(calls).fill({}) });
  record(app, 1, run("done", 0)); // not for it
  record(app, 1, run("done"));
  record(app, 1, run("error"));
  const kept = history(app, 1);
  assertEquals([kept.filtered, kept.runs.map((r) => r.end)], [1, ["error", "done"]]);
  assertEquals(kept.runs[0].time instanceof Date, true);
  assertEquals(history(app, 2), { runs: [], filtered: 0 });
  assertEquals(history(other, 1), { runs: [], filtered: 0 });

  for (let i = 0; i < 30; i++) record(app, 1, run("done"));
  assertEquals(history(app, 1).runs.length, 20);
});
