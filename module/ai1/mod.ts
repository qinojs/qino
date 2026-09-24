import { run } from "./lib/run.ts";

import type { App, StandardSchema, Tool, Transcript } from "@qino/qino";
import type { Opts } from "./lib/run.ts";

export { AiError, run } from "./lib/run.ts";
export type { Adapter } from "./lib/run.ts";

/** Provider-neutral chat messages. An image `url` may be a data URL. */
type Part = { type: "text"; text: string } | { type: "image"; url: string };
type ToolCall = { id: string; name: string; args: unknown };
export type Message =
  | { role: "system" | "user"; content: string | Part[] }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; id: string; content: string };

export type TextInput = {
  messages: Message[];
  /** Offered to the model; calling them is the caller's business. */
  tools?: Pick<Tool, "name" | "description" | "parameters">[];
  temperature?: number;
  maxTokens?: number;
  /** Streams the answer. Once text went out, a failure no longer falls back. */
  onText?: (delta: string) => void;
};
/** `truncated`: cut off at `maxTokens`. `usage` in tokens. */
export type TextOutput = { text: string; toolCalls: ToolCall[]; truncated: boolean; usage: { input: number; output: number } };
export type ObjectInput<T> = Omit<TextInput, "tools"> & { schema: StandardSchema<T> };
export type TranslateInput = { text: string; to: string; from?: string; format?: "md" | "html" };
export type DecideInput = { text: string; question?: string; options: string[] };

/** A plain string is short for one user message. */
export const text = (app: App, input: string | TextInput, opts?: Opts): Promise<TextOutput> =>
  run(app, "text", typeof input === "string" ? { messages: [{ role: "user", content: input }] } : input, opts);
/** Structured answer, validated against `schema`. */
export const object = <T>(app: App, input: ObjectInput<T>, opts?: Opts): Promise<T> => run(app, "object", input, opts);
export const embed = (app: App, input: { texts: string[] }, opts?: Opts): Promise<number[][]> => run(app, "embed", input, opts);
/** Image URLs (data URLs where the provider returns bytes). */
export const image = (app: App, input: { prompt: string; size?: string; n?: number }, opts?: Opts): Promise<string[]> => run(app, "image", input, opts);
export const transcribe = (app: App, input: { file: File; language?: string }, opts?: Opts): Promise<Transcript> => run(app, "transcribe", input, opts);
export const translate = (app: App, input: TranslateInput, opts?: Opts): Promise<string> => run(app, "translate", input, opts);
/** Pick one of `options` (classify, route, judge on a scale). */
export const decide = (app: App, input: DecideInput, opts?: Opts): Promise<{ choice: string; probabilities?: Record<string, number> }> => run(app, "decide", input, opts);
