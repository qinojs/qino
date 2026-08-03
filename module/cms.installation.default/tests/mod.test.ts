import { assertEquals } from "../../core/tests/deps.ts";
import { name, needs, recommended } from "../plugin.ts";

Deno.test("cms.installation.default: needs is the hard minimum, everything else is a recommendation", () => {
  assertEquals(name, "cms.installation.default");
  assertEquals(needs, ["cms"]);
  assertEquals(new Set(recommended).size, recommended.length);
  for (const mod of ["cms.frontend.2", "cms.backend", "cms.cont.flexible", "cms.cont.login4", "cms.layout.backend", "cms.layout.login", "cms.image2", "error_report"])
    assertEquals(recommended.includes(mod), true, mod);
});

Deno.test("cms.installation.default: every recommendation exists and its needs come along", async () => {
  const store = JSON.parse(await Deno.readTextFile(new URL("../../store.json", import.meta.url)));
  assertEquals(recommended.filter((mod) => !store.modules[mod]), [], "not in the store");

  // A recommendation whose needs are missing would abort the boot in #order() — keep the set closed.
  const present = new Set(["core", ...needs, ...recommended]);
  const missing: string[] = [];
  for (const mod of recommended) {
    const plugin = await import(new URL(`../../${mod}/plugin.ts`, import.meta.url).href);
    for (const need of plugin.needs ?? []) if (!present.has(need)) missing.push(`${mod} needs ${need}`);
  }
  assertEquals(missing, []);
});
