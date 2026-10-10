import { AiError } from "./request.ts";

import type { DecideInput } from "../mod.ts";
import type { Adapter, Call } from "./request.ts";

const probability = (p: unknown): p is number => typeof p === "number" && Number.isFinite(p) && p >= 0 && p <= 1;

// with options a choice, without a noul (does it hold?): its probability of yes
async function decide(call: Call, { content, question, options }: DecideInput, path = "/systemone") {
  if (typeof content !== "string") throw new AiError("This decision adapter accepts text only");
  const decide = options
    ? { type: "choice", instructions: question ?? "Classify the input.", criteria: options }
    : { type: "noul", instructions: question ?? "Does it hold?", criteria: { true: "yes", false: "no" } };
  const res = await call.fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...call.key && { authorization: "Bearer " + call.key } },
    body: JSON.stringify({ model: call.model, state: content, questions: { decide } }),
  });
  const data = await res.json();
  call.usage(data.usage?.input_tokens, data.usage?.output_tokens);
  const answer = data.answers?.decide ?? {};
  if (!options) {
    if (!probability(answer.noul)) throw new AiError("Invalid probability in the answer");
    return { choice: answer.noul >= .5 ? "yes" : "no", probabilities: { yes: answer.noul, no: 1 - answer.noul } };
  }
  if (!Object.hasOwn(options, answer.choice)) throw new AiError(`Not an option: ${answer.choice}`);
  const probabilities = answer.probabilities;
  if (!probabilities || Object.keys(probabilities).length !== Object.keys(options).length ||
    Object.keys(options).some((name) => !Object.hasOwn(probabilities, name) || !probability(probabilities[name]))) {
    throw new AiError("Invalid probabilities in the answer");
  }
  return { choice: answer.choice, probabilities };
}

/** TypeSafe-compatible state, questions and answers, below the provider's versioned endpoint. */
export const systemone: Adapter = { decide };

/** The same decision protocol at `/decisions`. */
export const decisions: Adapter = { decide: (call, input: DecideInput) => decide(call, input, "/decisions") };
