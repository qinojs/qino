import { toTools, ValidationError } from "@qino/qino";

import { DESCRIPTION, input, keep } from "./api.ts";

import type { App, Tool } from "@qino/qino";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };
export { api } from "./api.ts";

// What agents tell the developers about the system, beside what they keep about the user and for
// themselves. Hooked into ai.agent, so it can be left out or replaced.

/** Told to every agent as a session starts. */
const HINT = (tool: string) => `## Feedback\nWhen something was not set up, a tool's description was unclear, a tool ` +
  `failed or one was missing, or you have an idea for this system, tell the people behind it with ${tool}: briefly, ` +
  `once per problem. Then go on with the task.`;

/** The model that answered last in `session`: the one calling a tool there. */
const modelOf = async (app: App, session: number) => await app.db.one`SELECT am.name FROM ai_session_message m
  JOIN ai_model_provider mp ON mp.id = m.model_provider_id JOIN ai_model am ON am.id = mp.model_id
  WHERE m.session_id = ${session} ORDER BY m.id DESC LIMIT 1` as string | undefined;

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  // every agent may report, its agent, session and model kept with it: it need not tell its model
  app.on("ai.agent:turn", (turn) => {
    const [tool] = toTools({ feedback: app.apiTree["ai.agent.feedback"] });
    if (!tool) return;
    const { model: _, ...properties } = (tool.parameters.properties ?? {}) as Record<string, unknown>;
    turn.parts.push(HINT(tool.name));
    turn.tools.push({
      ...tool, description: DESCRIPTION, parameters: { ...tool.parameters, properties },
      execute: async (args) => {
        const valid = input["~standard"].validate(args); // as through the api: called directly, not through it
        if (valid.issues) throw new ValidationError(valid.issues);
        const { kind, about, content } = valid.value, model = await modelOf(app, turn.session);
        return keep(app, { kind, about, content, model, usr: turn.usrId, agent: turn.agent, session: turn.session });
      },
    } satisfies Tool);
  }, { signal });
}
