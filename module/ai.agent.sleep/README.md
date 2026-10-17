# ai.agent.sleep

What an [agent](../ai.agent/) does while nobody talks with it, as a person sleeps. Hooked into
ai.agent, so it can be left out or replaced for experiments.

## Sleep (`lib/agent.sleep.ts`)

At night (cron, 2 am) every agent with new messages since it last slept goes over them, as a person
sleeps: what was said is processed, what went under found, what matters firmed up, the rest let go.
Its role is the yardstick: nothing it keeps may drift from its goal or change it.

- **Thinkers** read each session (`thinkers`: models, comma-separated; empty: one as ai chooses) and
  list what the memories lack, which memories held, which are outdated, each with the messages it
  rests on. What cites no message of that session is dropped: the merger would believe it.
- **The merger** weighs all thoughts against the memories and their strength: add (from which
  session), merge, strengthen, weaken, forget (only the wrong or replaced; fading does the rest).
- **Batches** (ai `batch`): slow, about half the price; nobody waits.
- **Review first:** the plan is kept in `ai_agent_sleep` and applied by `sleeps/:sleep/apply`, or at
  once with `apply`. A new memory is kept as its session's user, so a personal one becomes theirs
  ([ai.user_memory](../ai.user_memory/)); merged ones keep the first id and the others' strength.
- **Only with enough to go over:** an agent sleeps once `minChars` (2000) characters were said since it
  last slept; asked to (`{ agent }`), on whatever is new.
- **Budget:** at most `sessions` sessions a night, of each the latest `chars` characters.
- **As whom:** the models run as the user who started the night ("Sleep now"), at night as nobody; a ChatGPT
  plan then answers through the user set in [`ai.chatgpt`](../ai.chatgpt/)'s `usr`.

`sleeps` `get` lists the latest nights, `post` starts one now, for all agents or `{ agent }` (superuser); the agents' backend has it as "Sleep now".

## Compaction (`lib/session.compaction.ts`)

A session grown past 80 % of its model's context (`ai_model.context_length`) is compacted after an
answer, in the background (`ai.agent:answered`):

- **Same model, messages and tools** as the answer, plus an instruction at the end: the prompt cache
  holds. Only the agent's `remember` runs then.
- **First what lasts:** the agent keeps the user's rules and preferences as memories, then writes a
  handoff of the whole session, topic by topic from the start (an earlier summary carried over): the
  goal and the user's instructions in their words, decisions, errors and fixes, what was done (ids,
  urls), what is open, the next step.
- **The last 4 turns stay word for word**, fewer while they alone fill more than 40 % of the context.
- **The summary is kept** as a `system` message with `summary: { from }` (the first message kept
  word for word). Before each turn (`ai.agent:history`) only the latest summary and what came from
  `from` on are sent; a compaction still running is waited for.
- **The record stays:** nothing is deleted; `search` still finds everything. Without this module the
  summaries go out as notes amid the history.

**On request:** `sessions/:session/compact` `post` compacts after the current or next answer, however
long the session is: its user may, a superuser for all. An agent given the tools `aiAgentSleep_*`
does it when told ("compact the session"); after its answer, so with the turn it was asked in.

Why so: usual compactions keep only 17 % of the rules a user gives in a session; kept apart first,
over 90 % ("Lost in Compaction", 2026). Summarizing with the session's model reads the history from
the cache, a small model would read it all anew.

Later, when measured: old tool results cleared before summarizing, compaction between the tool
steps of one turn (needs a hook in `ai.tools`).
