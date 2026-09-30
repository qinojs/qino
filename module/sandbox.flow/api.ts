import { Access, NotFoundError, s } from "@qino/qino";

import { run } from "./mod.ts";
import { toFlow } from "./lib/row.ts";

import type { ApiTree, Ctx, Params, StandardSchema } from "@qino/qino";

// Flows belong to their owner, who made them: nobody else sees them, as if they did not exist. Their
// tools run with the owner's rights, so a flow can never do more than its owner.
// Superusers only, for now: events are not filtered by rights yet, a flow sees every event of its host.

const host = s.string().describe("The object whose event starts it: app, db");
const event = s.string().describe("The event's name, e.g. table:update-after");
const steps = s.array(s.record(s.any()))
  .describe("{ description, fn } with fn as JS source, or { description, debounce: { ms, by } }; each gets the " +
    "previous result (the first the event), a falsy one stops");

/** What makes a flow; to make one, host, event and steps are needed. */
const optional = {
  description: s.optional(s.string()),
  tools: s.optional(s.array(s.string())).describe("The tools it may call, by name"),
  active: s.optional(s.boolean()).describe("Listen to the event; default false"),
  test: s.optional(s.boolean()).describe("Only get_* tools take effect; default true"),
};
const fields = { ...optional, host, event, steps };
const changes = { ...optional, host: s.optional(host), event: s.optional(event), steps: s.optional(steps) };

type Fields = {
  description?: string;
  host?: string;
  event?: string;
  tools?: string[];
  steps?: unknown[];
  active?: boolean;
  test?: boolean;
};

const verb = <T extends Params>(
  description: string,
  execute: (params: T, ctx: Ctx) => unknown,
  input?: Record<string, StandardSchema>,
) => ({
  description,
  access: Access.SUPERUSER,
  ...input && { input: s.object(input) },
  execute: execute as (params: Params, ctx: Ctx) => unknown,
});

/** The row's columns from what was written; JSON where the table keeps it. */
const columns = ({ tools, steps, ...rest }: Fields) => ({
  ...rest,
  ...tools && { tools: JSON.stringify(tools) },
  ...steps && { steps: JSON.stringify(steps) },
});

const row = async (ctx: Ctx, id: number) => (await ctx.app.db.row`SELECT * FROM flow WHERE id = ${id}`)!;

const show = (row: Record<string, unknown>) => {
  const { owner: _, ...flow } = toFlow(row);
  return { id: Number(row.id), ...flow, active: Boolean(row.active) };
};

export const api: ApiTree = {
  flows: {
    get: verb("Your flows", async (_, ctx) =>
      (await ctx.app.db.query`SELECT * FROM flow WHERE usr_id = ${ctx.userId} ORDER BY id`).map(show)),
    post: verb<Fields>(
      "Make a flow, owned by you: when the event fires, its steps run in a sandbox with the tools it may use",
      async (params, ctx) => {
        const id = await ctx.app.db.table("flow").insert({ ...columns(params), usr_id: ctx.userId });
        return { id: Number(id) };
      },
      fields,
    ),
    ":flow": {
      paramSchema: s.number().describe("Flow ID"),
      resolve: async (id: unknown, ctx: Ctx) => {
        const owner = Number(await ctx.app.db.one`SELECT usr_id FROM flow WHERE id = ${id}`);
        if (!ctx.userId || owner !== ctx.userId) throw new NotFoundError("No such flow");
        return id;
      },
      get: verb<{ flow: number }>("The flow", async ({ flow }, ctx) => show(await row(ctx, flow))),
      patch: verb<Fields & { flow: number }>(
        "Change the flow; an active one listens anew",
        async ({ flow, ...params }, ctx) => {
          await ctx.app.db.table("flow").update(flow, columns(params));
          return { id: flow };
        },
        changes,
      ),
      delete: verb<{ flow: number }>("Delete the flow", async ({ flow }, ctx) => {
        await ctx.app.db.table("flow").delete(flow);
      }),
      test: {
        post: verb<{ flow: number; event: unknown; user?: number }>(
          "Try the flow on an example event, as a test run: only get_* tools take effect. Returns the trace.",
          async ({ flow, event, user }, ctx) =>
            run(ctx.app, { ...toFlow(await row(ctx, flow)), test: true }, event, { user }),
          {
            event: s.any().describe("The event as its listener would see it"),
            user: s.optional(s.number()).describe("Who caused it"),
          },
        ),
      },
    },
  },
};
