# ai1.agent

An agent is someone anyone can talk to: a role and the tool sets it may use. In a session it acts
with the rights of the user it talks with, so it can never do more than that user.

```ts
import { Agent, Session } from "@qino/qino/ai1.agent";

const agent = await Agent.create(app, { system: "You lead the website project.", tools: ["cms"] });
const session = await agent.start(usrId);
const { text } = await session.ask("What is still open?");
await session.ask("Do the first one."); // knows what came before
await new Session(app, session.id).ask("And then?"); // later, e.g. from the browser
```

- **Sessions** are fresh starts of the same agent. Each keeps everything exactly
  (`ai1_session_message`): questions, answers, tool calls and results, and failures as messages of
  role `error` (kept for analysis, not sent again).
- **One turn after the other** per session: a message waits for the answer to the one before.
- **Memories** are short facts that belong to the agent and outlast its sessions: everyone who
  talks with it shares them. They are always in its context, the strongest first; with the tools
  `remember` (also to replace one by its id) and `forget`, which every agent has, it keeps them up
  to date itself. What it renews stays strong, the rest fades (`score`, a half-life of a month).
- **Search** by meaning: its memories and the messages of all its sessions, with anyone, are
  embedded in the background (`ai1.embed`, where there is a collection); the tool `search` finds
  them. A memory it finds grows stronger, as recalling does.
- **Tool sets** are declared by the module that has the ability, by name; the agent keeps the names:
  ```ts
  export const ai1Tools = { cms: (app: App) => toTools(app.apiTree.cms) };
  ```

## Like a brain

What the agent grows into, modelled on how a person thinks and remembers.

| Person | What it does | In the agent | When |
|---|---|---|---|
| Working memory | what one thinks about now, small | the context of the current session | built |
| Record | (a diary, at most) | the exact protocol, `ai1_session_message` | built |
| Deliberate thinking ("system 2") | slow, thorough | the model with its tools (`ai1.tools`) | built |
| Episodic memory | experiences: what happened when | `search` in all past sessions; later a summary per session | search built |
| Semantic memory | knowledge, facts | memories: short facts, always in context | built |
| Attention | only what matters comes to mind | which memories get into the context: the strongest, later the fitting ones by vectors | later |
| Knowing people | what the other one is like | memories about the user (preferences, language) | with memories |
| Sleep | consolidate, clean up, replay | sessions condensed to memories, memories merged, skills derived | next |
| Procedural memory | skills, routines, habits | skills: instructions it writes itself | later |
| Emotion | what matters sticks | surprises, failures, the user's corrections and praise hit harder (`hit(…, 5)`) | later |
| Forgetting | the unimportant fades, a feature | memories never used lose weight (`score`) | built |
| Intuition ("system 1") | fast, cheap, mostly right | a quick `decide()` before the big model: new session? which memories? | later |
| Self-awareness | knowing what one knows, and how surely | checking after a task whether it worked, asking when unsure | later |
| Intentions | remembering to do something later | a message to itself by cron | with a cron tool set |
| Goals, drive | what one wants to reach | its own list of open tasks | later |
| Tiredness | energy is limited | cost as a budget; a full context is a reason to sleep | later |
