import { Output } from "@qino/qino";
import { assertEquals } from "@qino/qino/tests";

import { reports, suspects } from "../mod.ts";
import { get, settle, withApp } from "./app.ts";

Deno.test("security: suspicious paths stop early, report and eventually block the IP", () => withApp(async (app) => {
  for (const path of ["bulk/.env", "_profiler/phpinfo", "backup.sql", "server-status"]) assertEquals((await get(app, "7.7.7.7", path)).status, 404);
  await settle();
  assertEquals((await get(app, "7.7.7.7")).status, 429);
  assertEquals(reports(app)[0].reason, "suspicious path: server-status");

  // existing paths count nothing
  await get(app, "8.8.8.8");
  assertEquals(suspects(app).map((s) => s.key), ["7.7.7.7"]);
}));

Deno.test("security: 404s on foreign paths report lightly, unless security.foreignPaths is off", () => withApp(async (app) => {
  await get(app, "8.8.8.8", "kontakt.php");
  await get(app, "8.8.8.8", "css/style.css");
  await settle();
  assertEquals(reports(app).map((r) => r.reason), ["foreign path: css/style.css", "foreign path: kontakt.php"]);

  await app.settings.security.foreignPaths(false);
  await get(app, "9.9.9.9", "wp-admin/");
  await settle();
  assertEquals(suspects(app).map((s) => s.key), ["8.8.8.8"]);
}));

Deno.test("security: early paths never reach routing, foreign paths can exist or redirect", () => withApp(async (app) => {
  const routed: string[] = [];
  app.on("route", ({ ctx }) => {
    routed.push(ctx.req.appPath);
    throw new Output("Found", { status: ctx.req.appPath === "old.php" ? 301 : 200 });
  });
  for (const path of ["%2eenv", "nested/.GIT/config", "wp-admin/install.php"]) {
    assertEquals((await get(app, "7.7.7.7", path)).status, 404);
  }
  assertEquals(routed, []);
  assertEquals(reports(app).length, 3);
  assertEquals(Math.round(suspects(app)[0].strength), 45);
  assertEquals((await get(app, "8.8.8.8", "assets/app.js")).status, 200);
  assertEquals((await get(app, "8.8.8.8", "old.php")).status, 301);
  await settle();
  assertEquals(routed, ["assets/app.js", "old.php"]);
  assertEquals(reports(app).length, 3);
}));
