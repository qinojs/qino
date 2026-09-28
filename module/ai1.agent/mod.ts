import { unixTime } from "@qino/qino";

import { ask } from "./lib/turn.ts";

import type { App } from "@qino/qino";
import type { Message, Part, TextOutput } from "@qino/qino/ai1";

/** Someone anyone can talk to: a role and the tool sets it may use. */
export class Agent {
  #app: App;
  #id: number;
  constructor(app: App, id: number) {
    this.#app = app;
    this.#id = id;
  }
  get id(): number { return this.#id; }

  static async create(app: App, { system = "", tools = [] }: { system?: string; tools?: string[] } = {}): Promise<Agent> {
    return new Agent(app, Number(await app.db.table("ai1_agent").insert({ system, tools: JSON.stringify(tools), time: unixTime() })));
  }

  /** A fresh start with user `usrId`, in which the agent acts with that user's rights. */
  async start(usrId: number): Promise<Session> {
    return new Session(this.#app, Number(await this.#app.db.table("ai1_session").insert({ agent_id: this.#id, usr_id: usrId, time: unixTime() })));
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
}
