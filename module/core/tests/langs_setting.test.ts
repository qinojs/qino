import { test } from "node:test";
import { App, fs } from "@qino/qino";
import { assertEquals } from "./deps.ts";

test("the site's languages follow the setting at once, without a restart", async () => {
  const dir = await fs.tempDir() + "/";
  await using app = new App({ db: "sqlite::memory:", dir });
  await app.init();
  assertEquals(app.languages.all, ["en"]);
  await app.settings.core.langs("de,en");
  assertEquals(app.languages.all, ["de", "en"]);
  assertEquals(app.languages.def, "de");
  await fs.remove(dir, { recursive: true });
});
