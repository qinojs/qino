// deno-lint-ignore-file no-explicit-any
import { errMsg, getCtx, sql } from "@qino/qino";
import { run } from "@qino/qino/ai.tools";

import type { App, Sql, Tool } from "@qino/qino";

const ROWS = 5, PLAN = 30; // of a read or a plan, what the model sees
const SECONDS = 60; // a long try would hold its locks
// What the assistant may try: reads, plans (no ANALYZE: it runs the query), and writes it only
// simulates. No DDL: MySQL commits it at once.
const TRY = /^\s*(?:(SELECT|WITH)|(EXPLAIN)\b(?![\s\S]*\bANALY[SZ]E\b)|INSERT|UPDATE|DELETE|REPLACE)\b/i;
const ROLLBACK = Symbol("rollback");

const cap = (rows: unknown[], max: number) => rows.length > max ? [...rows.slice(0, max), "…"] : rows;

/** Run one statement in a transaction that is always rolled back, within SECONDS where the database
 *  can stop it (not SQLite): a read's first rows, a plan, or how many rows a write would change. */
async function tryIt(app: App, statement: string) {
  const db = app.db, text = String(statement).trim().replace(/;$/, ""), kind = TRY.exec(text);
  if (!kind || text.includes(";")) return { error: "One SELECT, EXPLAIN, INSERT, UPDATE or DELETE only" };
  if (!kind[1] && !kind[2] && db.dialect === "mysql" && Number(await db.one`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND engine <> 'InnoDB'`)) {
    return { error: "Writes can't be simulated here: some tables don't roll back" };
  }
  const limit = (q: Sql) => db.dialect === "mysql" ? sql`SET STATEMENT max_statement_time=${sql.raw(String(SECONDS))} FOR ${q}` : q;
  let out: unknown;
  return db.transaction(async () => {
    if (db.dialect === "postgres") await db.exec`SET LOCAL statement_timeout = ${sql.raw(String(SECONDS * 1000))}`;
    out = kind[1] ? { rows: cap(await db.query`${limit(sql`SELECT * FROM (${sql.raw(text)}) t LIMIT ${ROWS + 1}`)}`, ROWS) }
      : kind[2] ? { plan: cap(await db.query`${limit(sql.raw(text))}`, PLAN) }
      : { wouldChange: (await db.exec`${limit(sql.raw(text))}`).affectedRows };
    throw ROLLBACK;
  }).catch((e) => e === ROLLBACK ? out : { error: errMsg(e) });
}

const trySql = (app: App): Tool => ({
  name: "try_sql",
  description: `Check one statement on the database, in a transaction that is rolled back: a read gives its first ${ROWS} rows, EXPLAIN the plan, a write how many rows it would change. Nothing is kept. On big tables check the plan first.`,
  parameters: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] },
  execute: (args: any) => tryIt(app, args?.sql),
});

// Natural-language → SQL via ai, checked with try_sql. Returns the generated SQL (never auto-run).
// `current` is the query already in the editor, passed so the model can refine it.
export function askDbAi(app: App, question: string, schema: string, current = ""): Promise<{ sql: string; note: string }> {
  const system = `You are a SQL assistant for a ${app.db.dialect} database.
Translate the user's request into a single SQL query for this schema:

${schema}

Check the query with try_sql and fix it until it works. Then answer with it in a \`\`\`sql block and one short line for the user; for a write, how many rows it would change. The user runs it.`;

  return run(app, {
    messages: [
      { role: "system", content: system },
      ...current ? [{ role: "user" as const, content: `The editor currently contains this query — refine it if the request relates to it:\n${current}` }] : [],
      { role: "user", content: question },
    ],
    tools: [trySql(app)],
    usrId: getCtx().userId,
    temperature: 0.2,
  }).then(({ text }) => ({
    sql: (/```(?:sql)?\s*\n([\s\S]*?)```/i.exec(text)?.[1] ?? "").trim(),
    note: text.replace(/```[\s\S]*?```/, "").trim(),
  }), (e) => ({ sql: "", note: errMsg(e) }));
}
