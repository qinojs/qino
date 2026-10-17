# ai.agent.recall

What comes to mind as the user talks with an [agent](../ai.agent/), as with a person. Hooked into
ai.agent, so it can be left out or replaced for experiments.

- **From what was said:** the vector each user message gets anyway (`ai.agent:associate`), in the
  background: the answer does not wait for it.
- **Only what is missing:** the agent's memories and the tools of its api paths that are close to it
  (score ≥ 0.75), at most 3 of each, and not given yet in the session (first message or an earlier note).
  Tools only come up for an agent with more than it is given at the start.
- **As a note** (`session.note`): the agent reads it with its next step, else with the next question;
  with other notes waiting, as one message. Nothing close, no note.

```
## Possibly relevant memories
[42] Invoices always in CHF
## Possibly relevant tools
Not in your tool list; call them with call_tool.
- fin_invoices_get: List invoices
```

Memories about the user come to mind the same way from [ai.user_memory](../ai.user_memory/).
