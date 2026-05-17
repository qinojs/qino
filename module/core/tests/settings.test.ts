import { assertEquals, assertThrows } from "./deps.ts";
import { settingsSourceAttr } from "../lib/settings.ts";

Deno.test("settings: settingsSourceAttr produces path strings", () => {
  assertEquals(
    settingsSourceAttr({ kind: "app", path: ["core", "", "uploadMaxFileSize"] }),
    "/api/core/settings/core/uploadMaxFileSize",
  );
  assertEquals(
    settingsSourceAttr({ kind: "ctx", path: ["cms", "editmode"] }),
    "/api/core/ctx-settings/cms/editmode",
  );
  assertEquals(
    settingsSourceAttr({ kind: "page", id: 42, path: ["layout"] }),
    "/api/cms/node/42/settings/layout",
  );
});

Deno.test("settings: invalid sources fail early", () => {
  assertThrows(() => settingsSourceAttr({ kind: "page", path: [] }), Error, "Missing node settings source id");
  assertThrows(() => settingsSourceAttr({ kind: "bogus" as "app" }), Error, 'Unknown settings source "bogus"');
});
