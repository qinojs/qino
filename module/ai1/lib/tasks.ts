import { s, toJsonSchema } from "@qino/qino";

import { AiError } from "./run.ts";

import type { StandardSchema } from "@qino/qino";
import type { DecideInput, Message, ObjectInput, TextInput, TranslateInput } from "../mod.ts";
import type { Task } from "./run.ts";

/** Parse a model's JSON answer (fences tolerated) and validate it against `schema`. */
export function parseObject<T>(text: string, schema: StandardSchema<T>): T {
  let value;
  try { value = JSON.parse(text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, "$1")); }
  catch { throw new AiError(`Not JSON: ${text.slice(0, 100)}`); }
  const result = schema["~standard"].validate(value);
  if (result.issues) throw new AiError(`Invalid answer: ${result.issues.map((i) => i.message).join(", ")}`);
  return result.value;
}

const prompt = (system: string, user: string): Message[] => [{ role: "system", content: system }, { role: "user", content: user }];

// Images need a vision model, tools one that calls them.
const needs = ({ messages, tools }: TextInput) => [
  ...messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image")) ? ["vision"] : [],
  ...tools?.length ? ["tools"] : [],
];

export const ai1Tasks: Record<string, Task> = {
  text: { needs },
  object: {
    needs,
    via: {
      text: async ({ schema, ...input }: ObjectInput<unknown>, next) => parseObject((await next({
        ...input,
        messages: [{ role: "system", content: `Reply with JSON only, matching this JSON Schema: ${JSON.stringify(toJsonSchema(schema))}` }, ...input.messages],
      })).text, schema),
    },
  },
  translate: {
    via: {
      text: async ({ text, to, from, format }: TranslateInput, next) => (await next({
        messages: prompt(`Translate the user's text ${from ? `from "${from}" ` : ""}to "${to}".${format ? ` It is ${format === "md" ? "Markdown" : "HTML"}: keep the markup.` : ""} Reply with the translation only.`, text),
        temperature: 0,
      })).text,
    },
  },
  decide: {
    via: {
      object: async ({ text, question, options }: DecideInput, next) => {
        const { choice } = await next({
          messages: prompt(`${question ?? "Classify the user's input."} Answer with exactly one of these options: ${JSON.stringify(options)}`, text),
          schema: s.object({ choice: s.string() }),
          temperature: 0,
        });
        if (!options.includes(choice)) throw new AiError(`Not an option: ${choice}`);
        return { choice };
      },
    },
  },
};
