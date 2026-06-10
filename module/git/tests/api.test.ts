// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "../../core/tests/deps.ts";
import { toTools } from "../../core/mod.ts";
import { addModule, api, name, needs } from "../plugin.ts";
import { getModuleGitInfo } from "../mod.ts";

Deno.test("git: module metadata and apt tools are wired", () => {
  assertEquals(name, "git");
  assertEquals(needs, []);
  // The module name becomes the first path segment (aptTree.git = api), so tools are git/*.
  assertEquals(toTools({ git: api }).map((tool) => tool.name), [
    "get_git_status",
    "get_git_log",
    "get_git_tags",
    "post_git_pull",
    "post_git_push",
    "post_git_checkout",
    "post_git_install",
  ]);
});

Deno.test("git: getModuleGitInfo returns nulls for modules without path", async () => {
  const app = { modules: { get: () => ({ path: undefined }) } };
  assertEquals(await getModuleGitInfo(app as never, "missing"), { gitRoot: null, info: null });
});

Deno.test("git: addModule imports the plugin", async () => {
  const calls: string[] = [];
  const app = { modules: { import: (path: string) => calls.push(path) } };
  await addModule(app as never, new URL("file:///tmp/qino-module/plugin.ts").href);
  assertEquals(calls, ["file:///tmp/qino-module/plugin.ts"]);
});
