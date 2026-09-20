// deno-lint-ignore-file no-explicit-any
import { assertEquals, DbFileManager, fakeRender } from "./deps.ts";

/** A manager over one file row, recording what `extractText()` writes. */
function fixture(dir: string, row: Record<string, unknown>) {
  const updates: Record<string, unknown>[] = [];
  const queries: [string, unknown[]][] = [];
  const app = {
    db: {
      row: () => Promise.resolve({ ...row }),
      table: () => ({
        update: (_id: number, vs: Record<string, unknown>) => { updates.push(vs); return Promise.resolve(); },
      }),
      query: (...a: any[]) => { queries.push(fakeRender(a[0], a.slice(1)) as any); return Promise.resolve([]); },
    },
  };
  return { updates, queries, files: new DbFileManager(app as never, dir) };
}

Deno.test("DbFile: text files are indexed as they are, capped, and shared with their duplicates", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const { updates, queries, files } = fixture(dir, { id: 3, name: "a.txt", mime: "text/plain", md5: "aaa" });
    await Deno.writeTextFile(dir + "/aaa", "x".repeat(8_500));

    const text = await (await files.file(3)).extractText();
    assertEquals([text.length, updates.length], [8_000, 1]);
    assertEquals(updates[0].text, text);

    // every other row on the same blob gets it too — same content, same text
    const [sql, params] = queries[0];
    assertEquals(sql.includes("WHERE md5=") && sql.includes("id!="), true);
    assertEquals(params, [text, "aaa", 3]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("DbFile: a file without text is marked as looked at, not as untouched", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const { updates, files } = fixture(dir, { id: 3, name: "a.txt", mime: "text/plain", md5: "aaa" });
    await Deno.writeTextFile(dir + "/aaa", "");

    assertEquals(await (await files.file(3)).extractText(), "");
    assertEquals(updates[0].text, ""); // "" = nothing to find, null = nobody looked
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("DbFile: a file that is gone is not indexed", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const { updates, queries, files } = fixture(dir, { id: 3, name: "a.txt", mime: "text/plain", md5: "gone" });
    assertEquals(await (await files.file(3)).extractText(), "");
    assertEquals([updates.length, queries.length], [0, 0]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
