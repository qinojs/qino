import { Access, NotFoundError, s } from "@qino/qino";

import { run } from "./mod.ts";
import { toFlow } from "./lib/row.ts";

import type { ApiTree, Ctx, Params, StandardSchema } from "@qino/qino";

// Flows belong to their owner, who made them: nobody else sees them, as if they did not exist. Their
// tools run with the owner's rights, so a flow can never do more than its owner.
// Superusers only, for now: events are not filtered by rights yet, a flow sees every event of its host.

const host = s.string().describe("Who fires the event: app or db (db:table:update-after is host db)");
const event = s.string().describe("The event's name without its host, e.g. table:update-after, cron:hour");
const code = s.string().describe(
  "Body of async (event, tools, state, context, owner) => { … }, plain JavaScript in a sandbox: no imports, " +
    "no fetch, no app globals. One statement per line, indented by 2 spaces.\n" +
    "- event: its data, e.g. { table, id, data } for table events (id: primary key as text), " +
    "{ time, date, weekday, hour } for cron\n" +
    "- tools.<name>(params): only the listed tools, one params object (path params by name), always await\n" +
    "- state: kept from run to run (not in test mode), e.g. state.invoice = id\n" +
    "- context.user: who caused the event; owner: the flow's owner (\"when I …\" is context.user === owner)\n" +
    "- return early when the event is not for this flow; the returned value shows in the trace\n" +
    "Example:\n" +
    "if (event.table !== 'text_lang' || event.data.lang !== 'de') return;\n" +
    "const { all } = await tools.core_languages_get();\n" +
    "for (const lang of all.filter((l) => l !== 'de')) {\n" +
    "  await tools.cmsText_text_translate_post({ text: event.data.text_id, targetLang: lang });\n" +
    "}\n" +
    "return 'translated';",
);

/** What makes a flow; to make one, host, event and code are needed. */
const optional = {
  description: s.optional(s.string()).describe("What it does, a sentence in the user's language"),
  tools: s.optional(s.array(s.string())).describe("Tools the code may call, e.g. [\"core_languages_get\"]"),
  active: s.optional(s.boolean()).describe("Listen to the event; default false. Only when the user says so"),
  test: s.optional(s.boolean()).describe(
    "Test mode, default true: only *_get tools take effect, others are skipped and return undefined; " +
      "state is not kept",
  ),
};
const fields = { ...optional, host, event, code };
const changes = { ...optional, host: s.optional(host), event: s.optional(event), code: s.optional(code) };

type Fields = {
  description?: string;
  host?: string;
  event?: string;
  tools?: string[];
  code?: string;
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
const columns = ({ tools, ...rest }: Fields) => ({ ...rest, ...tools && { tools: JSON.stringify(tools) } });

const row = async (ctx: Ctx, id: number) => (await ctx.app.db.row`SELECT * FROM flow WHERE id = ${id}`)!;

const show = (row: Record<string, unknown>) => {
  const { owner: _, ...flow } = toFlow(row);
  return { id: Number(row.id), ...flow, active: Boolean(row.active) };
};

export const api: ApiTree = {
  flows: {
    get: verb("Your flows, with their code and state", async (_, ctx) =>
      (await ctx.app.db.query`SELECT * FROM flow WHERE usr_id = ${ctx.userId} ORDER BY id`).map(show)),
    post: verb<Fields>(
      "Make a flow, owned by you: when the event fires, its code runs with the listed tools and your rights. " +
        "Starts inactive in test mode: test it with sandboxFlow_flow_test_post, fix it with " +
        "sandboxFlow_flow_patch, switch it on only when the user says so. Events and tools, if available: " +
        "aiDiscover_events_get, aiDiscover_event_get, aiDiscover_tools_get, aiDiscover_tool_get. Returns { id }.",
      async (params, ctx) => {
        const id = await ctx.app.db.table("flow").insert({ ...columns(params), usr_id: ctx.userId });
        return { id: Number(id) };
      },
      fields,
    ),
  },
  flow: {
    ":flow": {
      paramSchema: s.number().describe("Flow ID"),
      resolve: async (id: unknown, ctx: Ctx) => {
        const owner = Number(await ctx.app.db.one`SELECT usr_id FROM flow WHERE id = ${id}`);
        if (!ctx.userId || owner !== ctx.userId) throw new NotFoundError("No such flow");
        return id;
      },
      get: verb<{ flow: number }>(
        "The flow: description, on { host, event }, tools, code, state, test, active",
        async ({ flow }, ctx) => show(await row(ctx, flow)),
      ),
      patch: verb<Fields & { flow: number }>(
        "Change the flow, only the fields given; an active one listens anew. Switch on: { active: true, test: false }",
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
          "Run the flow once on an example event, always in test mode. Returns the trace " +
            "{ calls: [{ tool, args, result | skipped }], result, error?, end: done | error }",
          async ({ flow, event, user }, ctx) =>
            run(ctx.app, { ...toFlow(await row(ctx, flow)), test: true }, event, { user }),
          {
            event: s.any().describe("The event's data as the code gets it, e.g. { table: 'text_lang', id: '12:de', " +
              "data: { text_id: 12, lang: 'de', text: '…' } }"),
            user: s.optional(s.number()).describe("Who caused it: context.user in the code"),
          },
        ),
      },
    },
  },
};
