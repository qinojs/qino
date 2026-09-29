import { unixTime } from "@qino/qino";

import { ask, note } from "./lib/turn.ts";

import type { App } from "@qino/qino";
import type { Message, Part, TextOutput } from "@qino/qino/ai1";

/** Someone anyone can talk to: a role, the parts of the api it may use as tools, and how it chooses
 *  its model (ai1's `prefer`, e.g. `{ quality: 2, cost: 1 }`). */
export class Agent {
  #app: App;
  #id: number;
  constructor(app: App, id: number) {
    this.#app = app;
    this.#id = id;
  }
  get id(): number { return this.#id; }

  static async create(app: App, { system = "", tools = [], prefer }: { system?: string; tools?: string[]; prefer?: Record<string, number> } = {}): Promise<Agent> {
    return new Agent(app, Number(await app.db.table("ai1_agent").insert({ system, tools: JSON.stringify(tools), prefer: prefer ? JSON.stringify(prefer) : "", time: unixTime() })));
  }

  /** A fresh start with user `usrId`, in which the agent acts with that user's rights; `prefer`
   *  replaces the agent's for this session. */
  async start(usrId: number, { prefer }: { prefer?: Record<string, number> } = {}): Promise<Session> {
    return new Session(this.#app, Number(await this.#app.db.table("ai1_session").insert({ agent_id: this.#id, usr_id: usrId, prefer: prefer ? JSON.stringify(prefer) : "", time: unixTime() })));
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

  /** Answer `content`, going on from what was said; one turn after the other. */
  ask(content: string | Part[], opts: { onText?: (delta: string) => void } = {}): Promise<TextOutput & { messages: Message[] }> {
    return ask(this.#app, this.#id, content, opts);
  }

  /** Tell the agent something without asking. It reads it with the next question. */
  note(content: string | Part[]): Promise<void> {
    return note(this.#app, this.#id, content);
  }
}
