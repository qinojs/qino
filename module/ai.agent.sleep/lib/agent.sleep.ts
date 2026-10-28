import { errMsg, runAs, sql, unixTime } from "@qino/qino";
import { batch } from "@qino/qino/ai";
import { Agent } from "@qino/qino/ai.agent";
import { forget as weaken, hit, strength } from "@qino/qino/score";

import type { App } from "@qino/qino";
import type { Message } from "@qino/qino/ai";

// While nobody talks with it, an agent sleeps (nightly): it goes over what was said since it last
// slept, finds what went under, firms up what matters and lets go of the rest, measured against its
// role, which nothing it keeps may change. Thinkers (one or more models) each read every session and
// propose, with the messages as evidence; a merger weighs it all against the memories. Both run as
// batches (ai): slow, about half the price. The plan is kept, and applied only with `apply`.

const OWNER = "ai.agent.sleep";
const SCORE = "ai_agent_memory_use";
/** The thinkers' and the merger's choice of model: thorough over cheap, as nobody waits. */
const PREFER = { quality: 3, cost: 1 };

const THINK = (role: string, memories: string) => `\
You are the sleeping mind of an AI agent, going over a conversation it had while nobody talks with it.
Its role, the goal everything is measured by:
<role>
${role || "(none given)"}
</role>
Its memories now, by id:
${memories || "(none)"}

Think the conversation through thoroughly and from several sides, then list:
- missed: lasting knowledge in it that the memories lack and that serves the role: rules and preferences the
  user gave (casual ones too), corrections, solutions worth reusing. One short fact each.
- confirmed: memories the conversation used or proved right.
- outdated: memories it contradicted or made obsolete.
Each entry names the messages it rests on (their #ids). Nothing temporary, nothing that would change the role
or its goal. Few and sure beats many.`;

const MERGE = (role: string, memories: string, thinkers: number) => `\
You are the sleeping mind of an AI agent. ${thinkers > 1 ? `${thinkers} thinkers` : "A thinker"} went over the conversations it
had since it last slept; their thoughts follow, per session. Its role, the goal everything is measured by:
<role>
${role || "(none given)"}
</role>
Its memories now: id, strength (how often and how recently used, decaying), content:
${memories || "(none)"}

Decide what becomes of its memory:
- add: what was missed and matters for the role, with the session it comes from. What more thinkers found is
  surer; what one alone found needs good evidence.
- merge: memories that say the same or overlap: their ids and the one content they become.
- strengthen: memories the conversations confirmed.
- weaken: memories of little use for the role.
- forget: only what is wrong or replaced, never what is merely weak: fading does that.
Stay on the role: nothing that drifts from its goal or would change it. Empty lists are fine.`;

const ids = { type: "array", items: { type: "integer" } };
const withEvidence = (fields: Record<string, unknown>) =>
  ({ type: "array", items: { type: "object", properties: { ...fields, evidence: ids }, required: [...Object.keys(fields), "evidence"] } });
const THOUGHTS = {
  type: "object",
  properties: { missed: withEvidence({ content: { type: "string" } }), confirmed: withEvidence({ id: { type: "integer" } }), outdated: withEvidence({ id: { type: "integer" } }) },
  required: ["missed", "confirmed", "outdated"],
};
const PLAN = {
  type: "object",
  properties: {
    add: { type: "array", items: { type: "object", properties: { content: { type: "string" }, session: { type: "integer" } }, required: ["content", "session"] } },
    merge: { type: "array", items: { type: "object", properties: { ids, content: { type: "string" } }, required: ["ids", "content"] } },
    strengthen: ids,
    weaken: ids,
    forget: ids,
  },
  required: ["add", "merge", "strengthen", "weaken", "forget"],
};

type Thoughts = { missed: { content: string; evidence: number[] }[]; confirmed: { id: number; evidence: number[] }[]; outdated: { id: number; evidence: number[] }[] };
type Plan = { add: { content: string; session: number }[]; merge: { ids: number[]; content: string }[]; strengthen: number[]; weaken: number[]; forget: number[] };

const settings = (app: App) => app.settings[OWNER];

/** The agent's memories with their strength, for the prompts. */
async function memories(app: App, agent: number, withStrength = false) {
  const rows = await app.db.query`SELECT m.id, m.content, s.score FROM ai_agent_memory m
    LEFT JOIN score_ai_agent_memory_use s ON s.memory_id = m.id WHERE m.agent_id = ${agent} ORDER BY m.id`;
  return rows.map((m) => `[${m.id}]${withStrength ? ` ${m.score == null ? 0 : strength(app.db, SCORE, Number(m.score)).toFixed(2)}` : ""} ${m.content}`).join("\n");
}

const textOf = (content: Message["content"]) =>
  typeof content === "string" ? content : content.flatMap((p) => p.type === "text" ? [p.text] : []).join("\n");

/** What was said in `session` after message `since`, as lines `[#id role] text`, the latest within
 *  `chars`; tool results left out, calls named. */
async function transcript(app: App, session: number, since: number, chars: number) {
  const lines = [];
  for (const row of await app.db.query`SELECT id, message FROM ai_session_message WHERE session_id = ${session} AND id > ${since} ORDER BY id`) {
    const m = JSON.parse(String(row.message));
    const said = m.role === "tool" || m.role === "start" || (m.role === "system" && !m.summary) ? "" : textOf(m.content)
      + (m.toolCalls?.length ? ` (called ${m.toolCalls.map((c: { name: string }) => c.name).join(", ")})` : "");
    if (said.trim()) lines.push(`[#${row.id} ${m.summary ? "summary" : m.role}] ${said}`);
  }
  let text = "";
  for (const line of lines.reverse()) {
    if (text.length + line.length > chars) break;
    text = line + "\n" + text;
  }
  return text;
}

/** Start the night: every agent with at least `minChars` said since it last slept thinks it over, at most
 *  `sessions` sessions in all; only `agent`, it sleeps on whatever is new. Resolves to how many fell asleep. */
export async function sleep(app: App, agent?: number): Promise<number> {
  const thinkers = String(await settings(app).thinkers).split(",").map((m) => m.trim()).filter(Boolean);
  const models = thinkers.length ? thinkers : [undefined];
  const chars = Number(await settings(app).chars), enough = agent ? 1 : Number(await settings(app).minChars);
  let budget = Number(await settings(app).sessions), nights = 0;
  for (const { id, system } of await app.db.query`SELECT id, system FROM ai_agent ${agent ? sql`WHERE id = ${agent}` : sql``} ORDER BY id`) {
    if (budget <= 0) break;
    // a failed night goes over the same again
    const since = Number(await app.db.one`SELECT MAX(until) FROM ai_agent_sleep WHERE agent_id = ${id} AND stage <> ${"failed"}`) || 0;
    const sessions = (await app.db.query`SELECT s.id, MAX(m.id) AS last FROM ai_session s JOIN ai_session_message m ON m.session_id = s.id
      WHERE s.agent_id = ${id} AND m.id > ${since} GROUP BY s.id ORDER BY s.id`).slice(0, budget);
    const inputs = await Promise.all(sessions.map(async (s) => ({ session: Number(s.id), text: await transcript(app, Number(s.id), since, chars) })));
    // too little said: it sleeps another night, with more
    if (!sessions.length || inputs.reduce((sum, { text }) => sum + text.length, 0) < enough) continue;
    budget -= sessions.length;
    nights++;
    const until = Math.max(...sessions.map((s) => Number(s.last)));
    const night = Number(await app.db.table("ai_agent_sleep").insert({ agent_id: id, time: unixTime(), until, stage: "think", expected: sessions.length * models.length }));
    const prompt = THINK(String(system ?? ""), await memories(app, id));
    try {
      for (const [n, model] of models.entries()) {
        const items = inputs.map(({ session, text }) => ({
          id: `think:${night}:${session}:${n}`,
          input: { messages: [{ role: "system", content: prompt }, { role: "user", content: text || "(nothing said)" }], schema: THOUGHTS },
        }));
        await batch(app, "structured", { owner: OWNER, items }, { model, prefer: PREFER });
      }
    } catch (e) { // not submitted: the next night goes over the same
      await app.db.table("ai_agent_sleep").update(night, { stage: "failed", error: errMsg(e) });
      throw e;
    }
  }
  return nights;
}

/** An answer of a batch: a thinker's thoughts, or the merger's plan. */
export async function answered(app: App, { id, output, error }: { id: string; output?: unknown; error?: string }): Promise<void> {
  const [stage, sleepId] = id.split(":"), sleep = Number(sleepId);
  if (stage === "merge") {
    await app.db.table("ai_agent_sleep").update(sleep, error ? { stage: "failed", error } : { stage: "planned", plan: JSON.stringify(output) });
    if (!error && await settings(app).apply) await apply(app, sleep);
    return;
  }
  // a thought delivered twice (after a crash) counts once
  const thoughts = error ? { error } : await evidenced(app, Number(id.split(":")[2]), output as Thoughts);
  const kept = await app.db.table("ai_agent_sleep_thought").insert({ sleep_id: sleep, item: id, output: JSON.stringify(thoughts) })
    .then(() => true, () => false);
  const row = await app.db.row`SELECT expected, stage FROM ai_agent_sleep WHERE id = ${sleep}`;
  const got = Number(await app.db.one`SELECT COUNT(*) FROM ai_agent_sleep_thought WHERE sleep_id = ${sleep}`);
  if (kept && row?.stage === "think" && got >= Number(row.expected)) await merge(app, sleep);
}

/** Only what rests on messages of its session: a thinker may invent, the merger would believe it. */
async function evidenced(app: App, session: number, { missed = [], confirmed = [], outdated = [] }: Thoughts): Promise<Thoughts> {
  const cited = [...missed, ...confirmed, ...outdated].flatMap((t) => t.evidence ?? []).map(Number);
  const real = new Set((await app.db.col`SELECT id FROM ai_session_message WHERE session_id = ${session} AND ${sql.in("id", [0, ...cited])}`).map(Number));
  const ok = <T extends { evidence: number[] }>(list: T[]) => list.filter((t) => t.evidence?.length && t.evidence.every((id) => real.has(Number(id))));
  return { missed: ok(missed), confirmed: ok(confirmed), outdated: ok(outdated) };
}

/** All thoughts in: the merger weighs them against the memories. Without a single one the night failed. */
async function merge(app: App, sleep: number) {
  const { agent_id: agent } = (await app.db.row`SELECT agent_id FROM ai_agent_sleep WHERE id = ${sleep}`)!;
  const system = String(await app.db.one`SELECT system FROM ai_agent WHERE id = ${agent}` ?? "");
  const thoughts = new Map<string, Thoughts[]>();
  let error = "";
  for (const { item, output } of await app.db.query`SELECT item, output FROM ai_agent_sleep_thought WHERE sleep_id = ${sleep} ORDER BY item`) {
    const value = JSON.parse(String(output)), session = String(item).split(":")[2];
    if (value.error) error = value.error;
    else thoughts.set(session, [...thoughts.get(session) ?? [], value]);
  }
  if (!thoughts.size) return void await app.db.table("ai_agent_sleep").update(sleep, { stage: "failed", error: `No thinker answered: ${error}` });
  const thinkers = Math.max(0, ...[...thoughts.values()].map((t) => t.length));
  const text = [...thoughts].map(([session, list]) => `## Session ${session}\n${list.map((t, n) => `### Thinker ${n + 1}\n${JSON.stringify(t)}`).join("\n")}`).join("\n\n");
  await app.db.table("ai_agent_sleep").update(sleep, { stage: "merge" });
  const merger = String(await settings(app).merger) || undefined;
  await batch(app, "structured", {
    owner: OWNER,
    items: [{ id: `merge:${sleep}`, input: { messages: [{ role: "system", content: MERGE(system, await memories(app, agent, true), thinkers) }, { role: "user", content: text || "(no thoughts)" }], schema: PLAN } }],
  }, { model: merger, prefer: PREFER });
}

/** Carry out a sleep's plan: new memories are kept as said in their session (as its user, so personal ones
 *  become theirs: ai.user_memory), merged ones keep the first id and the others' strength. */
export async function apply(app: App, sleep: number): Promise<void> {
  const row = await app.db.row`SELECT agent_id, plan, stage FROM ai_agent_sleep WHERE id = ${sleep}`;
  if (row?.stage !== "planned") return;
  const agent = new Agent(app, Number(row.agent_id)), plan = JSON.parse(String(row.plan)) as Plan;
  const own = new Set((await app.db.col`SELECT id FROM ai_agent_memory WHERE agent_id = ${agent.id}`).map(Number));
  const mine = (list: number[] = []) => list.filter((id) => own.has(id));
  const users = new Map((await app.db.query`SELECT id, usr_id FROM ai_session WHERE agent_id = ${agent.id} AND
    ${sql.in("id", [0, ...(plan.add ?? []).map((a) => a.session)])}`).map((s) => [Number(s.id), Number(s.usr_id)]));
  const score = async (id: number) => Number(await app.db.one`SELECT score FROM score_ai_agent_memory_use WHERE memory_id = ${id}`) || 0;
  for (const { content, session } of plan.add ?? []) {
    const usr = users.get(Number(session));
    if (usr) await runAs(app, usr, OWNER, () => agent.remember(content)).catch((e) => console.error("[ai.agent.sleep] add:", errMsg(e)));
  }
  for (const { ids, content } of plan.merge ?? []) {
    const [keep, ...rest] = mine(ids);
    if (!keep || !rest.length) continue;
    let gained = 0;
    for (const id of rest) {
      const s = await score(id);
      if (s) gained += strength(app.db, SCORE, s);
      await agent.forget(id);
      own.delete(id);
    }
    await agent.remember(content, keep);
    if (gained > 0) await hit(app.db, SCORE, { memory_id: keep }, gained);
  }
  for (const id of mine(plan.strengthen)) await hit(app.db, SCORE, { memory_id: id });
  for (const id of mine(plan.weaken)) await weaken(app.db, SCORE, { memory_id: id }, 0.5);
  for (const id of mine(plan.forget)) await agent.forget(id);
  await app.db.table("ai_agent_sleep").update(sleep, { stage: "applied" });
}
