import { test } from "node:test";
import { App, fs } from "@qino/qino";
import { assertEquals, assertStringIncludes, fakeT } from "@qino/qino/tests";

import { cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };

const { name, dependencies } = manifest;

test("cms.cont.my.password renders the change form for the signed-in user", async () => {
  assertEquals(name, "cms.cont.my.password");
  assertEquals(dependencies, ["cms"]);
  const node = { app: { t: fakeT } } as never;
  const output = String(await cms.node.render(node, { ctx: { user: { username: "one@qino.test" } } } as never));
  assertStringIncludes(output, "autocomplete=new-password");
  assertStringIncludes(output, `value="one@qino.test"`);
  assertStringIncludes(String(await cms.node.render(node, { ctx: {} } as never)), "Please sign in.");
});

test("its texts come in the module's namespace, the general ones from the global", async () => {
  const dir = await fs.tempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add(name);
  try {
    await app.init();
    app.languages.setLangs(["en", "de"]);
    const t = app.t.in(name);
    const de = (fn: () => Promise<string>) => app.t.with({ lang: "de" }, fn);
    assertEquals(await de(() => t`Change password`), "Passwort ändern");
    assertEquals(await de(() => t`Please sign in.`), "Bitte melden Sie sich an.");
  } finally {
    await app.db.close();
    await fs.remove(dir, { recursive: true });
  }
});
