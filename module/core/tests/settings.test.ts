import { assertEquals, assertThrows } from "../../../deps.ts";
import { settingsSourceAttr } from "../lib/settings.ts";

Deno.test("settings: settingsSourceAttr normalizes app and ctx sources", () => {
  assertEquals(
    settingsSourceAttr({ kind: "app", path: ["core", "", "uploadMaxFileSize"] }),
    "{&quot;kind&quot;:&quot;app&quot;,&quot;path&quot;:[&quot;core&quot;,&quot;uploadMaxFileSize&quot;]}",
  );
  assertEquals(
    settingsSourceAttr({ kind: "ctx", path: ["cms", "editmode"] }),
    "{&quot;kind&quot;:&quot;ctx&quot;,&quot;path&quot;:[&quot;cms&quot;,&quot;editmode&quot;]}",
  );
});

Deno.test("settings: page sources are normalized to node sources", () => {
  assertEquals(
    settingsSourceAttr({ kind: "page", id: 42, path: ["layout"] }),
    "{&quot;kind&quot;:&quot;node&quot;,&quot;id&quot;:42,&quot;path&quot;:[&quot;layout&quot;]}",
  );
});

Deno.test("settings: invalid sources fail early", () => {
  assertThrows(() => settingsSourceAttr({ kind: "page", path: [] }), Error, "Missing node settings source id");
  assertThrows(() => settingsSourceAttr({ kind: "bogus" as "app" }), Error, 'Unknown settings source "bogus"');
});
