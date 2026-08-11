import { assertEquals } from "../../core/tests/deps.ts";
import { recommended } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };
const { name, dependencies } = manifest;

Deno.test("cms.installation.default: dependencies are the hard minimum, everything else is a recommendation", () => {
  assertEquals(name, "cms.installation.default");
  assertEquals(dependencies, ["cms"]);
  assertEquals(new Set(recommended).size, recommended.length);
  for (const mod of ["cms.frontend.2", "cms.backend", "cms.cont.flexible", "cms.cont.login4", "cms.layout.backend", "cms.layout.login", "cms.image2", "error_report"])
    assertEquals(recommended.includes(mod), true, mod);
});

Deno.test("cms.installation.default: every recommendation exists and its dependencies come along", async () => {
  const store = JSON.parse(await Deno.readTextFile(new URL("../../store.json", import.meta.url)));
  assertEquals(recommended.filter((mod) => !store.modules[mod]), [], "not in the store");

  // A recommendation whose dependencies are missing would abort the boot in #order() — keep the set closed.
  const present = new Set(["core", ...dependencies, ...recommended]);
  const missing = [];
  for (const mod of recommended) {
    const plugin = await import(new URL(`../../${mod}/plugin.ts`, import.meta.url).href);
    for (const need of dependencies ?? []) if (!present.has(need)) missing.push(`${mod} needs ${need}`);
  }
  assertEquals(missing, []);
});
