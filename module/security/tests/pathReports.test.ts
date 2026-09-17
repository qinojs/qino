import { assertEquals } from "@qino/qino/tests";

import { reports, suspects } from "../mod.ts";
import { close, from, testApp } from "./app.ts";

import type { App } from "@qino/qino";

const settle = () => new Promise((resolve) => setTimeout(resolve, 20)); // reports check their condition first
const get = (app: App, path: string, ip: string) => app.fetch(new Request("https://qino.test/site/" + path), from(ip));

Deno.test("security: 404s on suspicious paths report and block", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = await testApp(dir);
  try {
    for (const path of ["bulk/.env", "_profiler/phpinfo", "backup.sql", "server-status"]) assertEquals((await get(app, path, "7.7.7.7")).status, 404);
    await settle();
    assertEquals((await get(app, "robots.txt", "7.7.7.7")).status, 429);
    assertEquals(reports(app)[0].reason, "suspicious path: server-status");

    // existing paths count nothing
    await get(app, "robots.txt", "8.8.8.8");
    assertEquals(suspects(app).map((s) => s.key), ["7.7.7.7"]);
  } finally {
    await close(app);
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("security: 404s on foreign paths report lightly, unless security.foreignPaths is off", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = await testApp(dir);
  try {
    await get(app, "kontakt.php", "8.8.8.8");
    await get(app, "css/style.css", "8.8.8.8");
    await settle();
    assertEquals(reports(app).map((r) => r.reason), ["foreign path: css/style.css", "foreign path: kontakt.php"]);

    await app.settings.security.foreignPaths(false);
    await get(app, "wp-admin/", "9.9.9.9");
    await settle();
    assertEquals(suspects(app).map((s) => s.key), ["8.8.8.8"]);
  } finally {
    await close(app);
    await Deno.remove(dir, { recursive: true });
  }
});
