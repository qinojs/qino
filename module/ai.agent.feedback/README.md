# ai.agent.feedback

Beta: not reviewed yet. This module's design, behaviour and structure are provisional and may be reworked.

What [agents](../ai.agent/) tell the people behind the system, beside what they keep about the user
([ai.user_memory](../ai.user_memory/)) and for themselves (memories). Each report is of a `kind`, which
says for whom:

| kind | for | e.g. |
|---|---|---|
| `config` | the site's operator | no credit, a key or model missing, a setting, rights |
| `description` | Qino's developers | a tool's description unclear or misleading |
| `bug` | Qino's developers | a tool failed or did not do what it says |
| `idea` | Qino's developers | a missing tool or ability, an improvement |

- **Every agent** gets the tool `feedback_post { kind, about?, content }` and a short hint as its session starts
  (`ai.agent:turn`). Its agent, session, user and model (the one that answered last, so calling the
  tool) are kept with each report; the same report again from the same session is kept once.
- **Anyone signed in** may report through the api (`aiAgentFeedback_post`), e.g. an AI through MCP,
  naming its model itself (`model`).
- **Read and dealt with** in [cms.backend.ai.feedback](../cms.backend.ai.feedback/): by what it is about,
  with the failed tool calls of all sessions beside it.

`ai_agent_feedback`: `kind`, `model`, `about` (a tool's name, empty for the whole), `content`, `done` once dealt with.
