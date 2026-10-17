import { save } from "./record.ts";

import type { App } from "@qino/qino";
import type { Message, Part } from "@qino/qino/ai";

// The notes waiting per session, until the next step of a turn or the next question: given together,
// as one message.

type Note = { content: string | Part[]; known?: string[] };
const pending = new WeakMap<App, Map<number, Note[]>>();
const waiting = (app: App) => pending.get(app) ?? pending.set(app, new Map()).get(app)!;

/** One content of `notes`, in their order. */
const joined = (notes: (string | Part[])[]): string | Part[] => notes.every((c) => typeof c === "string")
  ? notes.join("\n\n")
  : notes.flatMap((c, i) => [...i ? [{ type: "text" as const, text: "\n\n" }] : [], ...typeof c === "string" ? [{ type: "text" as const, text: c }] : c]);

/** A note to wait in `session`; `known`: the keys of what it brings into the context (see `known`). */
export function add(app: App, session: number, note: Note): void {
  waiting(app).set(session, [...waiting(app).get(session) ?? [], note]);
}

/** The notes waiting in `session`, `first` before them, taken as one message; none if there are none. */
export function take(app: App, session: number, first?: string | Part[]): (Message & { known?: string[] })[] {
  const notes = [...first ? [{ content: first }] : [], ...waiting(app).get(session) ?? []];
  waiting(app).delete(session);
  if (!notes.length) return [];
  const known = notes.flatMap((note) => note.known ?? []);
  return [{ role: "system", content: joined(notes.map((note) => note.content)), ...known.length && { known } }];
}

/** Keep the notes still waiting in `session`, for the next question. */
export async function flush(app: App, session: number, agent: number): Promise<void> {
  for (const message of take(app, session)) await save(app, session, agent, message);
}
