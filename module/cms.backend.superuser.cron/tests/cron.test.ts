import { assertEquals } from "../../core/tests/deps.ts";
import type { App } from "../../core/mod.ts";
import api from "../nodeApi.ts";
import { cms, name, needs } from "../plugin.ts";
import { counts, renderJobs } from "../render.ts";

const t = (strings: TemplateStringsArray) => Promise.resolve(strings.join(""));
const app = { t } as unknown as App;

Deno.test("cms.backend.superuser.cron: metadata is wired", () => {
  assertEquals(name, "cms.backend.superuser.cron");
  assertEquals(needs, ["cms.backend", "cron"]);
  assertEquals(typeof cms.node.render, "function");
  assertEquals(typeof cms.node.api, "function");
  assertEquals(typeof cms.node.parts.list, "function");
});

Deno.test("cms.backend.superuser.cron: job table shows operational state safely", async () => {
  const out = String(await renderJobs(app, [{
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
  }]));
  assertEquals(out.includes("every week · at sunday 12:00:00 · jitter ±12h"), true);
  assertEquals(out.includes("timeout 15m"), true);
  assertEquals(out.includes("data-run-job=\"shop:&lt;script&gt;"), true);
  assertEquals(out.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"), true);
  assertEquals(out.includes("<script>alert"), false);
  assertEquals(out.includes("5123 ms"), true);
});

Deno.test("cms.backend.superuser.cron: counts only regard active jobs", () => {
  assertEquals(counts([
    { active: true, running: true, failures: 0 },
    { active: true, running: false, failures: 3 },
    { active: false, running: false, failures: 9 },
  ] as Parameters<typeof counts>[0]), { active: 2, running: 1, failed: 1 });
});

Deno.test("cms.backend.superuser.cron: node API reports failures instead of throwing", async () => {
  const node = { app } as never;
  assertEquals(await api(node, {}), false);
  // cron is not linked in this test app, so run/trigger throw — the node API must surface that.
  assertEquals(await api(node, { runDue: true }), { ok: false, message: 'Module "cron" is not linked' });
  assertEquals(await api(node, { runJob: "shop:sync" }), { ok: false, message: 'Module "cron" is not linked' });
});
