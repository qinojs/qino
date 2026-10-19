import { errMsg, NotFoundError, sql, unixTime } from "@qino/qino";
import { search } from "@qino/qino/ai.embed";
import { hit, sqlScore } from "@qino/qino/score";

import { keep } from "./search.ts";

import type { App } from "@qino/qino";

// Memories: short facts kept across sessions, by their owner (an agent, a user), the strongest first.
// What is renewed stays strong, the rest fades (score `<table>_use`); findable by meaning (`embedding_<table>`).

/** The characters of an agent's memories in its context, the strongest first; the weaker ones are left to its search. */
export const IN_MIND = 8000; // todo? adjustable
/** Memories read at a time, until `chars` are filled. */
const BLOCK = 100;
/** Only memories this close to what was said come to mind. */
const CLOSE = 0.75; // todo? adjustable

/** The memories of one owner in `table`, the owner by its column: `{ agent_id: 5 }`, `{ usr_id: 7 }`. */
export class Memories {
  #app: App;
  #table: string;
  #owner: Record<string, number>;
  constructor(app: App, table: string, owner: Record<string, number>) {
    this.#app = app;
    this.#table = table;
    this.#owner = owner;
  }

  get #mine() {
    const [[col, id]] = Object.entries(this.#owner);
    return sql`${sql.id(col)} = ${id}`;
  }

  /** The strongest first; with `chars`, those that fit in as many characters. */
  async list(chars = Infinity): Promise<{ id: number; content: string }[]> {
    const db = this.#app.db, out = [];
    let used = 0;
    for (let at = 0;; at += BLOCK) {
      const rows = await db.query`SELECT id, content FROM ${sql.id(this.#table)} m WHERE ${this.#mine}
        ORDER BY ${sqlScore(db, `${this.#table}_use`, { memory_id: sql`m.id` })} DESC, id LIMIT ${BLOCK} OFFSET ${at}`;
      for (const r of rows) {
        if ((used += String(r.content).length) > chars) return out;
        out.push({ id: Number(r.id), content: String(r.content) });
      }
      if (rows.length < BLOCK) return out;
    }
  }

  /** Keep a short fact, or replace the memory `replaces`; either grows stronger. Resolves to its id. */
  async keep(content: string, replaces?: number): Promise<number> {
    const table = this.#app.db.table(this.#table), values = { ...this.#owner, content, time: unixTime() };
    const id = replaces ? (await this.#own(replaces), await table.update(replaces, values), replaces) : Number(await table.insert(values));
    hit(this.#app.db, `${this.#table}_use`, { memory_id: id });
    keep(this.#app, this.#table, { ...this.#owner, memory_id: id }, content);
    return id;
  }

  async forget(id: number): Promise<void> {
    await this.#own(id);
    await this.#app.db.table(this.#table).delete(id);
  }

  /** Recalling by association: those close to `vector` (what was just said) grow stronger, the closer the
   *  more. Resolves to them. */
  async associate(vector: number[]): Promise<{ key: Record<string, unknown>; content: string; score: number }[]> {
    const near = await search(this.#app, { [this.#table]: this.#mine }, vector, { limit: 5 })
      .catch((e) => (console.error("[ai.agent] memories:", errMsg(e)), []));
    const close = near.filter((h) => h.score >= CLOSE);
    for (const { key, score } of close) hit(this.#app.db, `${this.#table}_use`, { memory_id: Number(key.memory_id) }, score);
    return close;
  }

  async #own(id: number) {
    if (!await this.#app.db.one`SELECT id FROM ${sql.id(this.#table)} WHERE id = ${id} AND ${this.#mine}`) throw new NotFoundError("No such memory");
  }
}

const of = (app: App, agent: number) => new Memories(app, "ai_agent_memory", { agent_id: agent });

/** The agent's memories, the strongest first; with `chars`, those that fit in as many characters. */
export const list = (app: App, agent: number, chars?: number): Promise<{ id: number; content: string }[]> => of(app, agent).list(chars);

/** The agent's memories close to what was just said grow stronger (`Memories.associate`). */
export const associate = (app: App, agent: number, vector: number[]): Promise<unknown> => of(app, agent).associate(vector);

/** Told to the agent above its memories. */
export const HINT = "Save durable knowledge with post_memories: rules, preferences, workflows, corrections, solutions worth reusing. Before each final answer, check: learned something lasting? Then save first. Update instead of duplicating; skip temporary details.";

/** The strongest memories for the context, under the hint on how to keep them. */
export async function index(app: App, agent: number): Promise<string> {
  const memories = await list(app, agent, IN_MIND);
  return `## Your memories\n${HINT}${memories.map((m) => `\n[${m.id}] ${m.content}`).join("")}`;
}

/** Keep a short fact, or replace the memory `replaces`; either grows stronger. Another module may
 *  keep a new one instead (`ai.agent:remember`, `prevent`). */
export async function remember(app: App, agent: number, content: string, replaces?: number): Promise<unknown> {
  const taken = replaces ? undefined : await app.fire("ai.agent:remember", { agent, content, prevent: false, result: undefined as unknown });
  if (taken?.prevent) return taken.result;
  return { id: await of(app, agent).keep(content, replaces) };
}

export async function forget(app: App, agent: number, id: number): Promise<{ forgotten: number }> {
  await of(app, agent).forget(id);
  return { forgotten: id };
}
