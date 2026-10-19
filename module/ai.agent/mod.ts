import { unixTime } from "@qino/qino";

import { keep } from "./lib/search.ts";
import { context, known } from "./lib/context.ts";
import { checkTools, ranked, toolsOf } from "./lib/tools.ts";
import { live } from "./lib/live.ts";
import * as memory from "./lib/memory.ts";
import { ask, cancel, note, running } from "./lib/turn.ts";

export { IN_MIND, Memories } from "./lib/memory.ts";
export { CALL, called } from "./lib/tools.ts";

import type { App, Tool } from "@qino/qino";
import type { Message, Part, TextOutput } from "@qino/qino/ai";

/** Someone anyone can talk to: a role, the tools of the api it may use, and how it chooses
 *  its model (ai's `prefer`, e.g. `{ quality: 2, cost: 1 }`). */
export class Agent {
  #app: App;
  #id: number;
  constructor(app: App, id: number) {
    this.#app = app;
    this.#id = id;
  }
  get id(): number { return this.#id; }

  /** A new agent; its role is made findable in the background. */
  static async create(app: App, { system = "", tools = [], prefer }: { system?: string; tools?: string[]; prefer?: Record<string, number> } = {}): Promise<Agent> {
    checkTools(app, tools);
    const id = Number(await app.db.table("ai_agent").insert({ system, tools: JSON.stringify(tools), prefer: prefer ? JSON.stringify(prefer) : "", time: unixTime() }));
    keep(app, "ai_agent", { agent_id: id }, system);
    return new Agent(app, id);
  }

  /** A fresh start with user `usrId`, in which the agent acts with that user's rights; `prefer`
   *  replaces the agent's for this session. */
  async start(usrId: number, { prefer }: { prefer?: Record<string, number> } = {}): Promise<Session> {
    return new Session(this.#app, Number(await this.#app.db.table("ai_session").insert({ agent_id: this.#id, usr_id: usrId, prefer: prefer ? JSON.stringify(prefer) : "", time: unixTime() })));
  }

  /** What it may use, as a session starts with it: its own tools (`always`), those of its api paths by
   *  nearness to its role (`score`), `given` the ones a session starts with. */
  tools(): ReturnType<typeof ranked> {
    return ranked(this.#app, this.#id);
  }

  /** The tools of its api paths, unranked. */
  async allowed(): Promise<Tool[]> {
    return toolsOf(this.#app, JSON.parse(String(await this.#app.db.one`SELECT tools FROM ai_agent WHERE id = ${this.#id}` || "[]")));
  }

  /** Keep a short fact, or replace the memory `replaces`; either grows stronger. Another module may
   *  keep a new one instead (`ai.agent:remember`). */
  remember(content: string, replaces?: number): Promise<unknown> {
    return memory.remember(this.#app, this.#id, content, replaces);
  }

  /** Forget one of its memories. */
  forget(id: number): Promise<{ forgotten: number }> {
    return memory.forget(this.#app, this.#id, id);
  }
}

/** A conversation with an agent, kept exactly. */
export class Session {
  #app: App;
  #id: number;
  constructor(app: App, id: number) {
    this.#app = app;
    this.#id = id;
  }
  get id(): number { return this.#id; }
  /** Whether an answer is on its way. */
  get running(): boolean { return running(this.#app, this.#id); }

  /** Answer `content`, going on from what was said; one turn after the other. */
  ask(content: string | Part[], opts: { onText?: (delta: string) => void } = {}): Promise<TextOutput & { messages: Message[] }> {
    return ask(this.#app, this.#id, content, opts);
  }

  /** What the model is given at the next turn: the messages and the tools' definitions; reading it changes nothing. */
  async context(): Promise<{ messages: Message[]; tools: Omit<Tool, "execute">[] }> {
    const { messages, tools } = await context(this.#app, this.#id);
    return { messages, tools: tools.map(({ name, description, parameters }) => ({ name, description, parameters })) };
  }

  /** Tell the agent something without asking. It reads it with its next step, or the next question;
   *  `known`: the keys of what it brings into its context. */
  note(content: string | Part[], { known }: { known?: string[] } = {}): Promise<void> {
    return note(this.#app, this.#id, content, known);
  }

  /** What its model has in its context, by key: its kept messages still sent (`#7`), its tools by name,
   *  memories by id (`5`), those of other modules as they name them (`u5`). After a compaction fewer. */
  known(): Promise<Set<string>> {
    return known(this.#app, this.#id);
  }

  /** Talk live, by voice: `sdp` is the browser's WebRTC offer, the answer's goes back to it. */
  live(sdp: string): Promise<string> {
    return live(this.#app, this.#id, sdp);
  }

  /** Stop the answer on its way; what was said and done so far stays. Whether one was on its way. */
  cancel(): boolean {
    return cancel(this.#app, this.#id);
  }
}
