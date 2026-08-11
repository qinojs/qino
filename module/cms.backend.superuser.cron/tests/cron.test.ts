import { assertEquals } from "../../core/tests/deps.ts";
import type { App } from "../../core/mod.ts";
import api from "../nodeApi.ts";
import { cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };
const { name, dependencies } = manifest;
import { counts, renderJobs } from "../render.ts";

const t = (strings: TemplateStringsArray) => Promise.resolve(strings.join(""));
const app = { t } as unknown as App;

type JobStatus = Parameters<typeof renderJobs>[1][number];
const jobStatus = (o: Partial<JobStatus>): JobStatus => ({
  id: "shop:sync", active: true, every: undefined, at: undefined, jitter: undefined, timeout: undefined,
  nextRun: 0, running: false, lastStarted: undefined, lastFinished: undefined, lastSuccess: undefined,
  durationMs: undefined, failures: 0, lastError: undefined, ...o,
});

Deno.test("cms.backend.superuser.cron: metadata is wired", () => {
  assertEquals(name, "cms.backend.superuser.cron");
  assertEquals(dependencies, ["cms.backend", "cron"]);
  assertEquals(typeof cms.node.render, "function");
  assertEquals(typeof cms.node.api, "function");
  assertEquals(typeof cms.node.parts.list, "function");
});

Deno.test("cms.backend.superuser.cron: job table shows operational state safely", async () => {
  const out = String(await renderJobs(app, [jobStatus({
    id: 'shop:<script>alert("x")</script>',
    every: "week",
    at: { weekday: "sunday", hour: 12 },
    jitter: 12 * 60 * 60,
    timeout: 900,
    nextRun: 1_800_000_000,
    durationMs: 5123,
    failures: 1,
    lastError: '<img src=x onerror="alert(1)">',
  })]));
  assertEquals(out.includes("every week · at sunday 12:00:00 · jitter ±12h"), true);
  assertEquals(out.includes("timeout 15m"), true);
  assertEquals(out.includes("data-run-job=\"shop:&lt;script&gt;"), true);
  assertEquals(out.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"), true);
  assertEquals(out.includes("<script>alert"), false);
  assertEquals(out.includes("5123 ms"), true);
});

Deno.test("cms.backend.superuser.cron: a job whose module was unlinked stays, greyed out and without actions", async () => {
  const out = String(await renderJobs(app, [jobStatus({ id: "gone:cleanup", active: false, lastSuccess: 1_700_000_005 })]));
  assertEquals(out.includes("<tr data-inactive>"), true);
  assertEquals(out.includes("inactive"), true);
  assertEquals(out.includes("data-run-job"), false); // no way to run a job nothing declares any more
  assertEquals(out.includes("gone:cleanup"), true); // but its history is still readable
});

Deno.test("cms.backend.superuser.cron: counts only regard active jobs", () => {
  assertEquals(counts([
    jobStatus({ running: true }),
    jobStatus({ failures: 3 }),
    jobStatus({ active: false, failures: 9 }),
  ]), { active: 2, running: 1, failed: 1 });
});

Deno.test("cms.backend.superuser.cron: node API reports failures instead of throwing", async () => {
  const node = { app } as never;
  assertEquals(await api(node, {}), false);
  // cron is not linked in this test app, so run/trigger throw — the node API must surface that.
  assertEquals(await api(node, { runDue: true }), { ok: false, message: 'Module "cron" is not linked' });
  assertEquals(await api(node, { runJob: "shop:sync" }), { ok: false, message: 'Module "cron" is not linked' });
});
