// deno-lint-ignore-file no-explicit-any
import { fs, unixTime } from "@qino/qino";
import { assertEquals } from "@qino/qino/tests";

import { api } from "../plugin.ts";

Deno.test("fileEditor: repeated saves advance the asset revision even beyond the current second", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const file = dir + "main.css";
  const ctx = {
    user: { superuser: true },
    app: {
      assetRev: unixTime() + 10,
      assertAllowedPath: () => {},
      modules: { get: () => ({ tmp: dir + "backups/" }) },
    },
  };
  const save = (api.save as any).put.execute;
  try {
    await fs.write(file, "/* Initial */");
    const initial = ctx.app.assetRev;
    assertEquals(await save({ file, content: "/* First */" }, ctx), 1);
    assertEquals(ctx.app.assetRev, initial + 1);
    assertEquals(await save({ file, content: "/* Second */" }, ctx), 1);
    assertEquals(ctx.app.assetRev, initial + 2);
    assertEquals(await fs.text(file), "/* Second */");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
