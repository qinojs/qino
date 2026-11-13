// A page is also addressed by `?cmspid=…&lang=…` (every link in edit mode is): whatever leads back to
// it must keep that query. See backend.toUrl and backend.toFields.
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { fs } from "@qino/qino";
import { assertEquals } from "@qino/qino/tests";

const STORES = ["../../", "../../../shop/", "../../../fin/", "../../../iot/", "../../../ops/"].map((dir) => new URL(dir, import.meta.url));

// what drops the query in a module's source: a bare "?…" link, form target or redirect, a link from
// the path alone, a GET form without the page's fields, and a script setting the query
const DROPS = [
  /(?:href|action)=["`]?\?/g, /redirect\(["`]\?/g, /"Location", *["`]\?/g, /toUrl\([\w.]*pathname[,)]/g,
  /<form[^>]*method="?get(?![^>]*>\s*\$\{(?:backend\.toFields|hidden)\()/g, /location\.search *=/g,
];

async function* sources(dir: string): AsyncGenerator<string> {
  for (const entry of await fs.list(dir)) {
    if (entry.isDirectory && entry.name !== "tests") yield* sources(dir + entry.name + "/");
    else if (entry.isFile && /\.(ts|js|mjs)$/.test(entry.name)) yield dir + entry.name;
  }
}

test("backend modules build no link, form or redirect that drops the page's query", async () => {
  const found: string[] = [];
  for (const store of STORES.map((url) => fileURLToPath(url))) {
    for (const module of await fs.list(store)) {
      if (!module.isDirectory || !/^cms\.(backend|layout\.backend)\b/.test(module.name)) continue;
      for await (const file of sources(store + module.name + "/")) {
        const source = await fs.text(file);
        for (const drop of DROPS) for (const { index } of source.matchAll(drop))
          found.push(`${file.slice(store.length)}:${source.slice(0, index).split("\n").length}`);
      }
    }
  }
  assertEquals(found, []);
});
