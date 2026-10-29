import { assertEquals } from "@qino/qino/tests";

import { renderDashboard } from "@qino/qino/cms.backend";

import { cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };

Deno.test("cms.backend.superuser.security: metadata is wired", () => {
  assertEquals(manifest.name, "cms.backend.superuser.security");
  assertEquals(manifest.dependencies, ["cms.backend"]);
});

Deno.test("cms.backend.superuser.security: the page is a dashboard of its sub-pages", () => {
  assertEquals(cms.node.render, renderDashboard);
});
