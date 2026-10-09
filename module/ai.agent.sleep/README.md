# ai.agent.sleep

What an [agent](../ai.agent/) does while nobody talks with it, as a person sleeps. Hooked into
ai.agent, so it can be left out or replaced for experiments.

## Compaction (`lib/session.compaction.ts`)

A session grown past 80 % of its model's context (`ai_model.context_length`) is compacted after an
answer, in the background (`ai.agent:answered`):

- **Same model, messages and tools** as the answer, plus an instruction at the end: the prompt cache
  holds. Only the agent's `remember` runs then.
- **First what lasts:** the agent keeps the user's rules and preferences as memories, then writes a
  handoff: the goal and the user's instructions in their words, decisions, errors and fixes, what
  was done (ids, urls), what is open, the next step.
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
steps of one turn (needs a hook in `ai.tools`), merging similar memories.
