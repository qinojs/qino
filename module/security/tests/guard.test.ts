import { assertEquals } from "@qino/qino/tests";

import { release, reports, suspects } from "../mod.ts";
import { close, ctxOf, get, inDir, settle, testApp, withApp } from "./app.ts";

import type { App } from "@qino/qino";

const stored = async (app: App, ip: string) =>
  Number(await app.db.one`SELECT COUNT(*) FROM score s JOIN log_ip l ON l.id = s.id WHERE l.ip = ${ip}`);

Deno.test("security: reports add up, delay, block and are stored from strength 5", () => withApp(async (app) => {
  await get(app, "6.6.6.6"); // puts the ip into log_ip
  await app.fire("suspicious", { ctx: ctxOf(app, "6.6.6.6"), weight: 2, reason: "small" });
  assertEquals((await get(app, "6.6.6.6")).status, 200); // delayed only
  assertEquals(await stored(app, "6.6.6.6"), 0);         // one-off slips stay in memory

  await app.fire("suspicious", { ctx: ctxOf(app, "6.6.6.6"), weight: 49, reason: "big" });
  await settle();
  const res = await get(app, "6.6.6.6");
  assertEquals(res.status, 429);
  assertEquals(Number(res.headers.get("retry-after")) > 0, true);
  assertEquals(await stored(app, "6.6.6.6"), 1);
  assertEquals((await get(app, "1.1.1.1")).status, 200); // other ips are not affected

  const [top] = suspects(app);
  assertEquals(top.key, "6.6.6.6");
  assertEquals(Math.round(top.strength), 51);
  assertEquals(top.blocked > 0, true);
  assertEquals(reports(app).map((r) => r.reason), ["big", "small"]);

  // reports from superusers are ignored
  await app.fire("suspicious", { ctx: Object.assign(ctxOf(app, "5.5.5.5"), { user: { superuser: true } }), weight: 99 });
  assertEquals((await get(app, "5.5.5.5")).status, 200);
}));

Deno.test("security: an IPv6 address counts as its /64, rotating inside it does not help", () => withApp(async (app) => {
  for (let i = 1; i <= 3; i++) await app.fire("suspicious", { ctx: ctxOf(app, `2a02:1210:3c4d:4200::${i}`), weight: 20 });
  assertEquals((await get(app, "2a02:1210:3c4d:4200:bc73:f023:7666:bd65")).status, 429);
  assertEquals((await get(app, "2a02:1210:3c4d:4201::1")).status, 200);
  assertEquals(suspects(app).map((s) => s.key), ["2a02:1210:3c4d:4200::/64"]);
  assertEquals(reports(app)[0].ip, "2a02:1210:3c4d:4200::3"); // reports keep the address
  await settle();
  assertEquals(await stored(app, "2a02:1210:3c4d:4200::/64"), 1);
}));

Deno.test("security: a restart keeps stored strengths, release forgets them", () => inDir(async (dir) => {
  const app = await testApp(dir);
  try {
    await get(app, "6.6.6.6");
    await app.fire("suspicious", { ctx: ctxOf(app, "6.6.6.6"), weight: 60 });
    await settle();
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
  }
}));
