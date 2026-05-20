import { assertEquals } from "../../core/tests/deps.ts";
import { matchPath, normalizePathList, parsePathList } from "../pathlist.ts";
import { suspiciousPath } from "../store.ts";

Deno.test("security path list supports simple wildcards", () => {
  const patterns = parsePathList("/wp-*\n*adminer.php\n*wp-content*");
  assertEquals(matchPath(patterns, "/wp-login.php"), "/wp-*");
  assertEquals(matchPath(patterns, "wp-login.php"), "/wp-*");
  assertEquals(matchPath(patterns, "/foo/adminer.php"), "*adminer.php");
  assertEquals(matchPath(patterns, "/x/wp-content/plugins/a.js"), "*wp-content*");
  assertEquals(matchPath(patterns, "/assets/app.js"), "");
});

Deno.test("security path list normalizes unsafe imports", () => {
  assertEquals(normalizePathList("#x\n*\n/*\n/wp-*\n/wp-*\n  *adminer.php  "), "/wp-*\n*adminer.php");
});

Deno.test("security allowed paths win over suspicious paths", async () => {
  const db = { all: () => Promise.resolve([{ name: "suspiciousPaths", value: "/wp-*" }, { name: "allowedPaths", value: "/wp-login.php" }]) };
  assertEquals(await suspiciousPath(db, "/wp-login.php"), "");
  assertEquals(await suspiciousPath(db, "/wp-admin"), "/wp-*");
});
