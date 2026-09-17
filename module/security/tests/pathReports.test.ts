import { assertEquals } from "@qino/qino/tests";

import { reports, suspects } from "../mod.ts";
import { get, settle, withApp } from "./app.ts";

Deno.test("security: 404s on suspicious paths report and block", () => withApp(async (app) => {
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
