import { run } from "./lib/run.ts";

import type { App, StandardSchema, Tool, Transcript } from "@qino/qino";
import type { Opts } from "./lib/run.ts";

export { AiError, candidates, run } from "./lib/run.ts";
export type { Adapter } from "./lib/run.ts";

/** Provider-neutral content. An image `url` may be a data URL. */
export type Part = { type: "text"; text: string } | { type: "image"; url: string };
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
/** `truncated`: cut off at `maxTokens`. Usage and timing of every call: the `ai1:call` event. */
export type TextOutput = { text: string; toolCalls: ToolCall[]; truncated: boolean };
/** A Standard Schema (`s.object(…)`) validates the answer; a plain JSON Schema only shapes it. */
export type StructuredInput<T> = Omit<TextInput, "tools"> & { schema: StandardSchema<T> | Record<string, unknown> };
export type EmbedInput = ({ texts: string[]; images?: never } | { images: string[]; texts?: never }) & { purpose?: "index" | "query" };
export type TranslateInput = { text: string | string[]; to: string; from?: string; format?: "md" | "html" };
export type DecideInput = { content: string | Part[]; question?: string; options: string[] };

/** A plain string is short for one user message. */
export const text = (app: App, input: string | TextInput, opts?: Opts): Promise<TextOutput> =>
  run(app, "text", typeof input === "string" ? { messages: [{ role: "user", content: input }] } : input, opts);
/** A structured answer: JSON in the shape of `schema`. */
export const structured = <T>(app: App, input: StructuredInput<T>, opts?: Opts): Promise<T> => run(app, "structured", input, opts);
export const embed = (app: App, input: EmbedInput, opts?: Opts): Promise<number[][]> => run(app, "embed", input, opts);
/** Image URLs (data URLs where the provider returns bytes). */
export const image = (app: App, input: { prompt: string; size?: string; n?: number }, opts?: Opts): Promise<string[]> => run(app, "image", input, opts);
/** Speech to text. */
export const transcribe = (app: App, input: { file: File; language?: string }, opts?: Opts): Promise<Transcript> => run(app, "transcribe", input, opts);
/** Text to speech: the audio as a data URL. */
export const speak = (app: App, input: { text: string; voice?: string; format?: string }, opts?: Opts): Promise<string> => run(app, "speak", input, opts);
/** One text or many at once; the answer has the same shape. */
export const translate = <T extends string | string[]>(app: App, input: TranslateInput & { text: T }, opts?: Opts): Promise<T> => run(app, "translate", input, opts);
/** Pick one of `options` (classify, route, judge on a scale), for text or images. */
export const decide = (app: App, input: DecideInput, opts?: Opts): Promise<{ choice: string; probabilities?: Record<string, number> }> => run(app, "decide", input, opts);
