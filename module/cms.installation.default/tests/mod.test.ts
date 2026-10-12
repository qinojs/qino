import { App } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { assertEquals } from "@qino/qino/tests";

import { recommended } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };

import type { Node } from "@qino/qino/cms";

const { name, dependencies } = manifest;

Deno.test("cms.installation.default: dependencies are the hard minimum, everything else is a recommendation", () => {
  assertEquals(name, "cms.installation.default");
  assertEquals(dependencies, ["cms"]);
  assertEquals(new Set(recommended).size, recommended.length);
});

Deno.test("cms.installation.default: every recommendation exists and its dependencies come along", async () => {
  const store = JSON.parse(await Deno.readTextFile(new URL("../../store.json", import.meta.url)));
  assertEquals(recommended.filter((mod) => !store.modules[mod]), [], "not in the store");

  // A recommendation whose dependencies are missing would abort the boot in #order() — keep the set closed.
  const present = new Set(["core", ...dependencies, ...recommended]);
  const missing = [];
  for (const mod of recommended) {
    await import(new URL(`../../${mod}/plugin.ts`, import.meta.url).href);
    for (const need of dependencies ?? []) if (!present.has(need)) missing.push(`${mod} needs ${need}`);
  }
  assertEquals(missing, []);
});

Deno.test("cms.installation.default: pages by name, once — starter.cms finds the same system pages", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  const store = app.stores.add(import.meta.resolve("../../store.json"));
  store.add("cms.installation.default").add("starter.cms");
  await app.init();
  try {
    const root = await cms(app).node(1);
    const named = async (parent: Node) => [...(await parent.children()).values()].map((p) => p.vs.name).filter(Boolean);
    const top = await named(root);
    assertEquals(top.filter((n) => n === "system").length, 1);
    const system = await root.child("system");
    for (const page of ["layout", "login", "trash", "no-access", "not-found"]) assertEquals((await named(system)).includes(page), true, page);
    assertEquals(new Set(await named(system)).size, (await named(system)).length, "no page twice");
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
