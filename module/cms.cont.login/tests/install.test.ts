// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "@qino/qino/tests";

import { install } from "../plugin.ts";

Deno.test("cms.cont.login: install takes over the contents of cms.cont.login4", async () => {
  let sql = "";
  const values: unknown[] = [], uninstalled: string[] = [];
  const app = {
    db: { exec: (parts: TemplateStringsArray, ...vs: unknown[]) => { sql = parts.join("?"); values.push(...vs); } },
    modules: { uninstall: (name: string) => Promise.resolve(void uninstalled.push(name)) },
  };

  await install({ app } as any);
  assertEquals(sql, "UPDATE page SET module = ? WHERE module = ?");
  assertEquals(values, ["cms.cont.login", "cms.cont.login4"]);
  assertEquals(uninstalled, ["cms.cont.login4"]);
});
