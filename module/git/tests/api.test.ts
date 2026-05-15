// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "../../../deps.ts";
import { toTools } from "../../core/lib/apt.ts";
import { addModule, api, getModuleGitInfo, init, name, needs } from "../mod.ts";

Deno.test("git: module metadata and apt tools are wired", () => {
  assertEquals(name, "git");
  assertEquals(needs, []);
  assertEquals(toTools(api).map((tool) => tool.name), [
    "get_git_status",
    "get_git_log",
    "get_git_tags",
    "post_git_pull",
    "post_git_push",
    "post_git_checkout",
    "post_git_install",
  ]);
});

Deno.test("git: init mounts git API subtree", () => {
  const app = { aptTree: {} };
  init(app as any);
  assertEquals((app.aptTree as any).git, api.git);
});

Deno.test("git: getModuleGitInfo returns nulls for modules without path", async () => {
  const app = { modules: { get: () => ({ path: undefined }) } };
  assertEquals(await getModuleGitInfo(app, "missing"), { gitRoot: null, info: null });
});

Deno.test("git: addModule normalizes file URLs before adding", async () => {
  const calls: string[] = [];
  const app = { modules: { add: (path: string) => calls.push(path) } };
  await addModule(app, new URL("file:///tmp/qino-module/mod.ts").href);
  assertEquals(calls, ["/tmp/qino-module/mod.ts"]);
});
