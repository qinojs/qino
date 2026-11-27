import { test } from "node:test";
import { assertEquals, testContext } from "@qino/qino/tests";

import { cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };

const { name, dependencies } = manifest;

test("cms.backend.settings: metadata is wired", () => {
  assertEquals(name, "cms.backend.settings");
  assertEquals(dependencies, ["cms.backend"]);
});

test("cms.backend.settings: render adds settings editor and app source", async () => {
  const ctx = await testContext();
  const out = String(cms.node.render({}, { ctx }));
  assertEquals(out.includes("<settings-editor"), true);
  assertEquals(out.includes("source=\"/api/core/settings\""), true);
  assertEquals(ctx.res.html.scripts.has("/m/core/pub/js/SettingsEditor.mjs"), true);
});
