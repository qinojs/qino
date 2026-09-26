import { s, toJsonSchema } from "@qino/qino";

import { AiError } from "./run.ts";

import type { StandardSchema } from "@qino/qino";
import type { DecideInput, Message, Part, StructuredInput, TranslateInput } from "../mod.ts";
import type { Capability } from "./run.ts";

type Schema = StructuredInput<unknown>["schema"];
const standard = (schema: Schema): schema is StandardSchema => "~standard" in schema;

/** A schema as JSON Schema: a Standard Schema converts, a JSON Schema is one already. */
export const jsonSchema = (schema: Schema): Record<string, unknown> => standard(schema) ? toJsonSchema(schema) : schema;

/** Parse a model's JSON answer (fences tolerated); a Standard Schema also validates it. */
export function parseStructured<T>(text: string, schema: StructuredInput<T>["schema"]): T {
  let value;
  try { value = JSON.parse(text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, "$1")); }
  catch { throw new AiError(`Not JSON: ${text.slice(0, 100)}`); }
  if (!standard(schema)) return value;
  const result = (schema as StandardSchema<T>)["~standard"].validate(value);
  if (result.issues) throw new AiError(`Invalid answer: ${result.issues.map((i) => i.message).join(", ")}`);
  return result.value;
}

const prompt = (system: string, content: string | Part[]): Message[] => [{ role: "system", content: system }, { role: "user", content }];

// Images need a vision model, tools one that calls them.
const needs = (input: { messages?: Message[]; content?: string | Part[]; tools?: unknown[] }) => [
  ...[input.content, ...input.messages?.map((m) => m.content) ?? []].some((c) => Array.isArray(c) && c.some((p) => p.type === "image")) ? ["vision"] : [],
  ...input.tools?.length ? ["tools"] : [],
];

export const ai1Capabilities: Record<string, Capability> = {
  text: { needs },
  embed: { oneModel: true, needs: (input: { images?: string[] }) => input.images?.length ? ["vision"] : [] },
  structured: {
    needs,
    via: {
      text: async ({ schema, ...input }: StructuredInput<unknown>, next) => parseStructured((await next({
        ...input,
        messages: [{ role: "system", content: `Reply with JSON only, matching this JSON Schema: ${JSON.stringify(jsonSchema(schema))}` }, ...input.messages],
      })).text, schema),
    },
  },
  translate: {
    via: {
      text: ({ text, to, from, format }: TranslateInput, next) => {
        const one = async (content: string) => (await next({
          messages: prompt(`Translate the user's text ${from ? `from "${from}" ` : ""}to "${to}".${format ? ` It is ${format === "md" ? "Markdown" : "HTML"}: keep the markup.` : ""} Reply with the translation only.`, content),
          temperature: 0,
        })).text;
        return Array.isArray(text) ? Promise.all(text.map(one)) : one(text);
      },
    },
  },
  decide: {
    needs,
    via: {
      structured: async ({ content, question, options }: DecideInput, next) => {
        const { choice } = await next({
          messages: prompt(`${question ?? "Classify the user's input."} Answer with exactly one of these options: ${JSON.stringify(options)}`, content),
          schema: s.object({ choice: s.string() }),
          temperature: 0,
        });
        if (!options.includes(choice)) throw new AiError(`Not an option: ${choice}`);
        return { choice };
      },
    },
  },
};
