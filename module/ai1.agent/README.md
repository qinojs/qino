# ai1.agent

An agent is someone anyone can talk to: a role and the tools of the api it may use. In a
session it acts with the rights of the user it talks with, so it can never do more than that user.

```ts
import { Agent, Session } from "@qino/qino/ai1.agent";

const agent = await Agent.create(app, { system: "You lead the website project.", tools: ["cms_*"] });
const session = await agent.start(usrId);
const { text } = await session.ask("What is still open?");
await session.ask("Do the first one."); // knows what came before
await new Session(app, session.id).ask("And then?"); // later, e.g. from the browser
```

- **What it is told first:** where it is and how it exists (`situation`: its id and the session's, the app's url, many
  sessions with shared memories, the user's rights), then its role (`## Your role`) and its memories.
- **Sessions** are fresh starts of the same agent. Each keeps everything exactly
  (`ai1_session_message`): questions, answers, tool calls and results; what the model was given
  (role with memories, tool definitions, prefer) as its first message, of role `system`; failures as
  messages of role `error`, not sent again. What was sent is never changed, only added to (prompt
  cache): what changes meanwhile (role, memories, tools) comes with the next session. A tool taken
  from the agent meanwhile no longer runs.
- **Notes:** `session.note(content)` tells the agent something without asking. It reads it with the
  next question (the model gets it as a `system` message in the history).
- **One turn after the other** per session: a message waits for the answer to the one before.
  `session.cancel()` stops the one on its way; after an hour it is cancelled anyway, so a stream
  that never ends cannot keep the session. What a cancelled step said so far stays, marked
  "(interrupted)"; a tool call it had not finished is lost.
- **Memories** are short facts that belong to the agent and outlast its sessions: everyone who
  talks with it shares them. They are always in its context, the strongest first; with the tools
  `remember` (also to replace one by its id) and `forget`, which every agent has, it keeps them up
  to date itself. What it renews stays strong, the rest fades (`score`, a half-life of a month).
- **Search** by meaning: its memories and the messages of all its sessions, with anyone, are
  embedded in the background (`ai1.embed`, where there is a collection); the tool `search` finds
  them. A memory it finds grows stronger, as recalling does: the closer, the more.
- **Association:** what the user says strengthens the memories close to it, the closer the more,
  with the vector the message gets anyway to be findable. In the background: nobody waits for it.
- **Its role** is embedded too (`embedding_ai1_agent`, again only when it changes): agents are found
  by what they do (`agents get { search }`), and with many tools it is the role they are ranked by.
- **Tools** come from the api, each module's api is its abilities: `tools` names them, each by its
  name (`cms_node_html_get`) or `prefix_*` for all below a path (`cms_*`, `cms_node_*`); an entry
  naming none is refused. Its own routes (memories, search) every agent has, with its id set.
- **Many tools:** with more than 20, it is given the 15 closest to its role, `find_tools` to find the
  others by meaning ([ai1.discover](../ai1.discover/)) and core's `core_toolCalls_post` to call them,
  only its own. What it is given stays the same all session long (prompt cache).

## Hooks

Other modules add to an agent without it knowing them (as [ai1.user_memory](../ai1.user_memory/) does):

- `ai1.agent:turn` `{ agent, session, usrId, parts, tools }`: before each turn, push texts into the
  context (`parts`, taken as the session starts) and tools (`tools`).
- `ai1.agent:remember` `{ agent, content, prevent, result }`: a new memory; set `prevent` and
  `result` to keep it elsewhere.
- `ai1.agent:associate` `{ agent, session, vector }`: in the background, what the user said as a
  vector, to strengthen what is close to it.
- `ai1.agent:history` `{ agent, session, history }`: before each turn, the kept messages to send
  (`{ id, message }`, oldest first); replace `history` to send less (compaction, as
  [ai1.agent.sleep](../ai1.agent.sleep/) does). What is kept stays.
- `ai1.agent:answered` `{ agent, session, usrId, messages, tools, model, modelProvider, prefer }`: in
  the background after an answer, all the model was given and answered, as sent.

## Api

```
agents                          get     find agents by their role { search? } → [{ id, role, score? }]
agents                          post    create { system, tools, prefer } → { id }
agent/:agent                    get · patch   its role, tools and prefer; anyone signed in may change them
agent/:agent/sessions           post    start a session, as yourself { prefer } → { id }
agent/:agent/memories           get · post { content, replaces? }
agent/:agent/memories/:memory   delete
agent/:agent/search             post    its own memory: memories and past sessions { query }
sessions/:session               get     its agent, everything said, whether an answer is on its way (running)
sessions/:session/ask           post    { content } → the answer
sessions/:session/note          post    { content }
sessions/:session/cancel        post    → { cancelled }
```

**Choosing the model:** `prefer` (ai1's weights, e.g. `{ quality: 2, cost: 1 }`) belongs to the agent;
a session may replace it for itself. Empty is no choice of its own: the agent's, else ai1's default.

A session is only there for its user: to anyone else it answers like a missing one. The agent itself
uses the same routes as tools.

## Like a brain

What the agent grows into, modelled on how a person thinks and remembers.

| Person | What it does | In the agent | When |
|---|---|---|---|
| Working memory | what one thinks about now, small | the context of the current session | built |
| Record | (a diary, at most) | the exact protocol, `ai1_session_message` | built |
| Deliberate thinking ("system 2") | slow, thorough | the model with its tools (`ai1.tools`) | built |
| Episodic memory | experiences: what happened when | `search` in all past sessions; later a summary per session | search built |
| Semantic memory | knowledge, facts | memories: short facts, the strongest 10 in context | built |
| Attention | only what matters comes to mind | association strengthens the memories close to what is said; later only the strongest and the close ones in the context | association built |
| Knowing people | what the other one is like | memories about the user (preferences, language) | with memories |
| Sleep | consolidate, clean up, replay | long sessions compacted, what lasts kept first ([ai1.agent.sleep](../ai1.agent.sleep/)); memories merged, skills derived | compaction built |
| Procedural memory | skills, routines, habits | skills: instructions it writes itself | later |
| Emotion | what matters sticks | surprises, failures, the user's corrections and praise hit harder (`hit(…, 5)`) | later |
| Forgetting | the unimportant fades, a feature | memories never used lose weight (`score`) | built |
| Intuition ("system 1") | fast, cheap, mostly right | a quick `decide()` before the big model: new session? which memories? | later |
| Self-awareness | knowing what one knows, and how surely | checking after a task whether it worked, asking when unsure | later |
| Intentions | remembering to do something later | a message to itself by cron | with a cron tool set |
| Goals, drive | what one wants to reach | its own list of open tasks | later |
| Tiredness | energy is limited | cost as a budget; a full context is a reason to sleep | later |
| Working in steps | a big job in parts, each one done | a page in several tool calls (frame, sections, script): a cancel loses one part, not all | idea |
