/* A local superuser for trying the backend of a test migration: shop-test@example.test / shop-test.
   Run from a site's folder (its server.ts), with the server stopped:
   deno task tool ../../qinojs/qino/meta/migrate_shp3/tools/testuser.ts */
import { pwHash } from "@qino/qino";

import type { App } from "@qino/qino";

const { app } = await import(`file://${Deno.cwd()}/server.ts`) as { app: App };
const db = app.db, address = "shop-test@example.test";
const id = await db.one`SELECT usr_id FROM usr_contact WHERE type = ${"email"} AND address = ${address}`
  ?? await db.table("usr").insert({ active: 1, username: address, given_name: "Shop", family_name: "Test", superuser: 1 });
await db.table("usr").update(id, { pw: await pwHash("shop-test"), superuser: 1, active: 1 });
await db.table("usr_contact").ensure({ type: "email", address, usr_id: id, main: true });
await db.flush();
console.log("user", id, address);
Deno.exit(0);
