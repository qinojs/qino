import { ConflictError } from "@qino/qino";
import { assertEquals, assertRejects } from "@qino/qino/tests";

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

Deno.test("smalltext export writes only files that differ", async () => {
  const root = await Deno.makeTempDir();
  await Deno.mkdir(root + "/same/locale", { recursive: true });
  await Deno.writeTextFile(root + "/same/locale/en.json", JSON.stringify({ next: "Next" }, null, 2) + "\n");

  const app = {
    languages: { export: () => ({ same: { en: { next: "Next" } }, other: { en: { next: "Next" } } }) },
    modules: { get: (name: string) => ({ dir: `${root}/${name}/` }) },
  };
  const node = { app, access: () => 2 };

  try {
    assertEquals(await cms.node.api(node as never, { export: 1 }), { written: [root + "/other/locale/en.json"], skipped: [] });
    assertEquals(await cms.node.api(node as never, { preview: 1 }), { changes: [] });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
