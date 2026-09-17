import { assertEquals } from "@qino/qino/tests";

import { release, reports, suspects } from "../mod.ts";
import { close, ctxOf, from, testApp } from "./app.ts";

const get = (app: { fetch: (r: Request, i?: object) => Promise<Response> }, ip: string) =>
  app.fetch(new Request("https://qino.test/site/robots.txt"), from(ip));
const stored = async (app: Awaited<ReturnType<typeof testApp>>, ip: string) =>
  Number(await app.db.one`SELECT COUNT(*) FROM score s JOIN log_ip l ON l.id = s.id WHERE l.ip = ${ip}`);

Deno.test("security: reports add up, delay, block and are stored from strength 5", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = await testApp(dir);
  try {
    await get(app, "6.6.6.6"); // puts the ip into log_ip
    await app.fire("suspicious", { ctx: ctxOf(app, "6.6.6.6"), weight: 2, reason: "small" });
    assertEquals((await get(app, "6.6.6.6")).status, 200); // delayed only
    assertEquals(await stored(app, "6.6.6.6"), 0);         // one-off slips stay in memory

    await app.fire("suspicious", { ctx: ctxOf(app, "6.6.6.6"), weight: 49, reason: "big" });
    const res = await get(app, "6.6.6.6");
    assertEquals(res.status, 429);
    assertEquals(Number(res.headers.get("retry-after")) > 0, true);
    assertEquals(await stored(app, "6.6.6.6"), 1);
    assertEquals((await get(app, "1.1.1.1")).status, 200); // other ips are not affected

    const [top] = suspects(app);
    assertEquals(top.ip, "6.6.6.6");
    assertEquals(Math.round(top.strength), 51);
    assertEquals(top.blocked > 0, true);
    assertEquals(reports(app).map((r) => r.reason), ["big", "small"]);
  } finally {
    await close(app);
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("security: a restart keeps stored strengths, release forgets them", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = await testApp(dir);
  try {
    await get(app, "6.6.6.6");
    await app.fire("suspicious", { ctx: ctxOf(app, "6.6.6.6"), weight: 60 });
    await new Promise((resolve) => setTimeout(resolve, 50)); // the score write is not awaited
  } finally {
    await close(app);
  }

  const again = await testApp(dir);
  try {
    assertEquals((await get(again, "6.6.6.6")).status, 429);
    await release(again, "6.6.6.6");
    assertEquals((await get(again, "6.6.6.6")).status, 200);
    assertEquals(await stored(again, "6.6.6.6"), 0);
    assertEquals(suspects(again), []);
  } finally {
    await close(again);
    await Deno.remove(dir, { recursive: true });
  }
});
