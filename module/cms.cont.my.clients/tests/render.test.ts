import { assert, assertEquals, assertStringIncludes, fakeT } from "@qino/qino/tests";

import { cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };

const { name, dependencies } = manifest;

const rows = [
  { id: 5, save_login: true, since: 1700000000, last_seen: Math.floor(Date.now() / 1000), user_agent: "Mozilla/5.0 (X11; Linux x86_64) Firefox/128.0", ip: "1.2.3.4" },
  { id: 6, save_login: false, since: 1600000000, last_seen: 1600000100, user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) CriOS/120", ip: "5.6.7.8" },
];

const node = { app: { t: fakeT, db: { query: () => Promise.resolve(rows) } } } as never;
const ctx = { user: {}, userId: 7, clientId: "5", req: { clientIp: "1.2.3.4" } } as never;

Deno.test("cms.cont.my.clients lists the user's devices", async () => {
  assertEquals(name, "cms.cont.my.clients");
  assertEquals(dependencies, ["cms"]);

  const output = String(await cms.node.render(node, { ctx }));
  assertStringIncludes(output, "Firefox · Linux");
  assertStringIncludes(output, "Chrome · iOS");
  assertStringIncludes(output, "<strong>1.2.3.4</strong>"); // own ip
  assertStringIncludes(output, "<strong>This device</strong>"); // own client
  assertStringIncludes(output, "data-logout=\"5\" data-self");
  assert(!output.includes("data-logout=\"6\" data-self"));
});

Deno.test("cms.cont.my.clients asks guests to sign in", async () => {
  assertStringIncludes(String(await cms.node.render(node, { ctx: {} } as never)), "Please sign in.");
});
