import { assertEquals } from "./deps.ts";
import { fromFileUrl, toFileUrl } from "../../../deps.ts";

const moduleDir = fromFileUrl(new URL("../../", import.meta.url));

async function* files(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const path = dir + entry.name;
    if (entry.isDirectory) {
      if (entry.name !== "tests") yield* files(path + "/");
    } else if (entry.isFile && entry.name.endsWith(".ts")) {
      yield path;
    }
  }
}

function imports(source: string): string[] {
  const specs: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;
  for (const match of source.matchAll(re)) if (match[1].startsWith(".")) specs.push(match[1]);
  return specs;
}

Deno.test("modules only consume public APIs of other modules", async () => {
  const errors: string[] = [];
  for await (const file of files(moduleDir)) {
    const sourceModule = file.slice(moduleDir.length).split("/")[0];
    for (const spec of imports(await Deno.readTextFile(file))) {
      const target = fromFileUrl(new URL(spec, toFileUrl(file)));
      if (!target.startsWith(moduleDir)) continue;
      const targetRel = target.slice(moduleDir.length);
      const targetModule = targetRel.split("/")[0];
      if (sourceModule !== targetModule && targetRel.includes("/lib/")) {
        errors.push(`${file.slice(moduleDir.length)} imports private ${targetRel}`);
      }
      if (/\/plugin\.(?:ts|js|mjs)$/.test(target)) {
        errors.push(`${file.slice(moduleDir.length)} imports plugin ${targetRel}`);
      }
    }
  }
  assertEquals(errors, []);
});
