import { assertEquals, assertRejects } from "../../core/tests/deps.ts";
import { ConflictError } from "../../core/mod.ts";
import { cms } from "../plugin.ts";

Deno.test("smalltext export rejects invalid locale files", async () => {
  const root = await Deno.makeTempDir();
  const broken = root + "/broken/locale/en.json";
  await Deno.mkdir(root + "/broken/locale", { recursive: true });
  await Deno.writeTextFile(broken, "{broken");

  const app = {
    languages: { export: () => ({ broken: { en: { next: "Broken" } } }) },
    modules: { get: (name: string) => ({ dir: `${root}/${name}/` }) },
  };
  const node = { app, access: () => 2 };

  try {
    await assertRejects(() => cms.node.api(node as never, { preview: 1 }), ConflictError, "Invalid locale file: broken/locale/en.json");
    await assertRejects(() => cms.node.api(node as never, { export: 1 }), ConflictError, "Invalid locale file: broken/locale/en.json");
    assertEquals(await Deno.readTextFile(broken), "{broken");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
