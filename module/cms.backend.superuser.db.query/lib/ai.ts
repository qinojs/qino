// deno-lint-ignore-file no-explicit-any
import type { App } from "../../core/mod.ts";
import type {} from "../../ai/mod.ts"; // App.ai type augmentation (runtime-optional)

// Natural-language → SQL via the ai module. Returns the generated SQL (never auto-run).
// `current` is the query already in the editor, passed so the model can refine it.
export async function askDbAi(app: App, question: string, schema: string, current = ""): Promise<{ sql: string; note: string }> {
  if (!app.ai) return { sql: "", note: "AI module not installed." };

  const system = `You are a SQL assistant for a ${app.db.dialect} database.
Translate the user's request into a single, safe SQL query for this schema:

${schema}

Reply with the SQL query only — no explanation, no markdown fences.`;

  const messages: { role: string; content: string }[] = [{ role: "system", content: system }];
  if (current) messages.push({ role: "user", content: `The editor currently contains this query — refine it if the request relates to it:\n${current}` });
  messages.push({ role: "user", content: question });

  const res = await app.ai.chat({
    messages,
    temperature: 0.2,
  }) as any;

  if (res?.error) return { sql: "", note: String(res.error?.message ?? res.error) };
  const content = String(res?.choices?.[0]?.message?.content ?? "").trim();
  return { sql: stripFence(content), note: "" };
}

// Drop a leading ```sql / trailing ``` fence if the model added one.
function stripFence(s: string): string {
  const m = s.match(/^```(?:sql)?\s*\n([\s\S]*?)\n?```$/i);
  return (m ? m[1] : s).trim();
}
