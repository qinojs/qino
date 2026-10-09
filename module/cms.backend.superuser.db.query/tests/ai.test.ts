// deno-lint-ignore-file no-explicit-any
import { App, runAs } from "@qino/qino";
import { assertEquals, assertStringIncludes } from "@qino/qino/tests";

import { askDbAi } from "../lib/ai.ts";

import type { Adapter } from "@qino/qino/ai";

// Tries each statement of the question (split by "|"), then answers with the first and the results.
const fake: Adapter = {
  text: (_call, { messages }) => {
    const statements = messages.at(-1).role === "tool" ? [] : String(messages.at(-1).content).split("|");
    const results = messages.filter((m: any) => m.role === "tool").map((m: any) => m.content).join("\n");
    return Promise.resolve(statements.length
      ? { text: "", toolCalls: statements.map((sql, i) => ({ id: String(i), name: "try_sql", args: { sql } })), truncated: false }
      : { text: `\`\`\`sql\nDELETE FROM grp\n\`\`\`\n${results}`, toolCalls: [], truncated: false });
  },
};

Deno.test("db.query ai: tries statements without keeping anything; the user gets the query", async () => {
  const app = new App({ db: "sqlite::memory:", dir: await Deno.makeTempDir() + "/" });
  for (const mod of ["ai", "ai.tools"]) app.modules.add(new URL(`../../${mod}/plugin.ts`, import.meta.url));
  await app.init();
  app.modules.get("ai")!.plugin.aiAdapters.fake = fake;
  try {
    await app.settings.core.url("https://example.test/");
    await app.db.table("usr").insert({ id: 7, username: "ann@example.test", active: true });
    await app.db.table("ai_provider").insert({ name: "fake", type: "fake", endpoint: "" });
    await app.db.table("ai_model").insert({ name: "m" });
    await app.db.table("ai_model_provider").insert({ model_id: 1, provider_id: 1 });
    for (const capability of ["text", "tools"]) await app.db.table("ai_model_capability").insert({ model_id: 1, capability });
    for (const name of ["a", "b"]) await app.db.table("grp").insert({ name });

    const question = "DELETE FROM grp|SELECT name FROM grp ORDER BY name|DROP TABLE grp|SELECT 1; DELETE FROM grp|EXPLAIN QUERY PLAN SELECT * FROM grp|EXPLAIN ANALYZE DELETE FROM grp";
    const { sql, note } = await runAs(app, 7, "test", () => askDbAi(app, question, ""));
    assertEquals(sql, "DELETE FROM grp");
    const [plan] = note.split("\n").splice(4, 1); // SQLite's plan columns vary by version
    assertStringIncludes(plan, '"detail":"SCAN grp"');
    assertEquals(note.split("\n").toSpliced(4, 1), [
      '{"wouldChange":2}',
      '{"rows":[{"name":"a"},{"name":"b"}]}',
      '{"error":"One SELECT, EXPLAIN, INSERT, UPDATE or DELETE only"}',
      '{"error":"One SELECT, EXPLAIN, INSERT, UPDATE or DELETE only"}',
      '{"error":"One SELECT, EXPLAIN, INSERT, UPDATE or DELETE only"}', // ANALYZE would run it
    ]);
    assertEquals(Number(await app.db.one`SELECT COUNT(*) FROM grp`), 2); // nothing was deleted
  } finally {
    delete app.modules.get("ai")!.plugin.aiAdapters.fake;
    await new Promise((r) => setTimeout(r, 60)); // the session writes 50 ms later
    await app.db.close();
  }
});
