import { errMsg, s } from "@qino/qino";
import { structured } from "@qino/qino/ai1";

import type { App } from "@qino/qino";

// Natural-language → SQL via ai1. Returns the generated SQL (never auto-run).
// `current` is the query already in the editor, passed so the model can refine it.
export function askDbAi(app: App, question: string, schema: string, current = ""): Promise<{ sql: string; note: string }> {
  const system = `You are a SQL assistant for a ${app.db.dialect} database.
Translate the user's request into a single, safe SQL query for this schema:

${schema}`;

  return structured(app, {
    messages: [
      { role: "system", content: system },
      ...current ? [{ role: "user" as const, content: `The editor currently contains this query — refine it if the request relates to it:\n${current}` }] : [],
      { role: "user", content: question },
    ],
    schema: s.object({ sql: s.string() }),
    temperature: 0.2,
  }).then(({ sql }) => ({ sql: sql.trim(), note: "" }), (e) => ({ sql: "", note: errMsg(e) }));
}
