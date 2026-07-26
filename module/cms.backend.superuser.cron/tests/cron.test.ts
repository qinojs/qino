import { assertEquals } from "../../core/tests/deps.ts";
import type { App } from "../../core/mod.ts";
import type { JobStatus, RunResult } from "../../cron/mod.ts";
import api from "../nodeApi.ts";
import { cms, name, needs } from "../plugin.ts";
import { renderJobs } from "../render.ts";

const t = (strings: TemplateStringsArray) => Promise.resolve(strings.join(""));

Deno.test("cms.backend.superuser.cron: metadata is wired", () => {
  assertEquals(name, "cms.backend.superuser.cron");
  assertEquals(needs, ["cms.backend", "cron"]);
  assertEquals(typeof cms.node.render, "function");
  assertEquals(typeof cms.node.api, "function");
  assertEquals(typeof cms.node.parts.list, "function");
});

Deno.test("cms.backend.superuser.cron: job table shows operational state safely", async () => {
  const jobs: JobStatus[] = [{
    id: 'shop:<script>alert("x")</script>',
    active: true,
    every: "week",
    at: { weekday: "sunday", hour: 12 },
    jitter: 12 * 60 * 60,
    timeout: 900,
    nextRun: 1_800_000_000,
    running: false,
    lastStarted: 1_700_000_000,
    lastFinished: 1_700_000_005,
    lastSuccess: 1_700_000_005,
    durationMs: 5123,
    failures: 1,
    lastError: '<img src=x onerror="alert(1)">',
  }];
  const out = String(await renderJobs({ t } as unknown as App, jobs));
  assertEquals(out.includes("every week · at sunday 12:00:00 · jitter ±12h"), true);
  assertEquals(out.includes("timeout 15m"), true);
  assertEquals(out.includes("data-run-job=\"shop:&lt;script&gt;"), true);
  assertEquals(out.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"), true);
  assertEquals(out.includes("<script>alert"), false);
  assertEquals(out.includes("5123 ms"), true);
});

Deno.test("cms.backend.superuser.cron: API triggers jobs through the protected node", async () => {
  const calls: string[] = [];
  const result: RunResult = { jobs: 1, due: 0, ran: ["shop:sync"], failed: {}, nextRun: 123 };
  const app = {
    t,
    fire: async (name: string, event: Record<string, unknown>) => {
      calls.push(`${name}:${event.id ?? ""}`);
      event.result = result;
      return event;
    },
  } as unknown as App;
  const node = { app };
  assertEquals(await api(node as never, { runJob: "shop:sync" }), { ok: true, message: "1 job run", result });
  assertEquals(await api(node as never, { runDue: true }), { ok: true, message: "1 job run", result });
  assertEquals(calls, ["cron:trigger:shop:sync", "cron:run:"]);
});
