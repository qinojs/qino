import { assertEquals } from "./deps.ts";
import { fromFileUrl, toFileUrl } from "../../../deps.ts";

const moduleDir = fromFileUrl(new URL("../../", import.meta.url));

async function* files(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const path = dir + entry.name;
    if (entry.isDirectory) {
      yield* files(path + "/");
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

// What a module may consume of another module: its mod.ts, and — from within tests — that module's
// tests/. Never a foreign lib/ (private) and never a foreign plugin.ts (the manifest belongs to the
// loader). Test-only seams therefore live in <module>/tests/deps.ts, so mod.ts stays minimal.
Deno.test("modules only consume public APIs of other modules", async () => {
  const errors: string[] = [];
  for await (const file of files(moduleDir)) {
    const fileRel = file.slice(moduleDir.length);
    const sourceModule = fileRel.split("/")[0];
    const sourceIsTest = fileRel.includes("/tests/");
    for (const spec of imports(await Deno.readTextFile(file))) {
      const target = fromFileUrl(new URL(spec, toFileUrl(file)));
      if (!target.startsWith(moduleDir)) continue;
      const targetRel = target.slice(moduleDir.length);
      if (sourceModule === targetRel.split("/")[0]) continue; // a module owns its own files
      if (targetRel.includes("/lib/")) errors.push(`${fileRel} imports private ${targetRel}`);
      if (/\/plugin\.(?:ts|js|mjs)$/.test(target)) errors.push(`${fileRel} imports plugin ${targetRel}`);
      if (targetRel.includes("/tests/") && !sourceIsTest) errors.push(`${fileRel} imports test-only ${targetRel}`);
    }
  }
  assertEquals(errors, []);
});

// Prospective package boundary: everything named cms* ships as @qino/cms, the rest as @qino/qino.
// An edge from the lower to the upper layer would make the cms unextractable, so it is an error
// here — type-only imports included, since they are just as unresolvable across a package split.
const isCms = (mod: string) => mod === "cms" || mod.startsWith("cms.");

Deno.test("the qino layer never imports from the cms layer", async () => {
  const errors: string[] = [];
  for await (const file of files(moduleDir)) {
    const sourceModule = file.slice(moduleDir.length).split("/")[0];
    if (isCms(sourceModule)) continue;
    for (const spec of imports(await Deno.readTextFile(file))) {
      const target = fromFileUrl(new URL(spec, toFileUrl(file)));
      if (!target.startsWith(moduleDir)) continue;
      const targetRel = target.slice(moduleDir.length);
      if (isCms(targetRel.split("/")[0])) {
        errors.push(`${file.slice(moduleDir.length)} imports ${targetRel}`);
      }
    }
  }
  assertEquals(errors, []);
});
