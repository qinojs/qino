import { Access, s, unixTime } from "@qino/qino";

import type { ApiTree, App, Ctx } from "@qino/qino";

/** What a report can be, and for whom: `config` for the site's operator, the others for Qino's developers. */
export const KINDS = {
  config: "for the site's operator: credit, keys, models, settings or rights missing",
  description: "a tool's description was unclear or misleading",
  bug: "a tool failed or did not do what it says",
  idea: "a missing tool or ability, or an improvement",
};

/** What a report says, for the agents' tool too. */
export const DESCRIPTION = "Tell the people behind this system about a problem with it or an idea for it, not about " +
  "the user's task: something not set up, an unclear tool description, a tool that failed, a missing tool or an " +
  "improvement. Briefly, once per problem; two matters, two reports.";

/** What a report takes, through the api and from an agent. */
export const input = s.object({
  kind: s.enum(Object.keys(KINDS) as (keyof typeof KINDS)[]).describe(Object.entries(KINDS).map(([kind, what]) => `${kind}: ${what}`).join("; ")),
  about: s.optional(s.string()).describe("The tool's name, or the part of the system it is about; empty for the whole"),
  content: s.string().describe("What was wrong, and what would have helped"),
  model: s.optional(s.string()).describe("Your AI model's name, if you know it, e.g. claude-opus-5-5"),
});

/** Keep a report; the same one again from the same session is kept once. */
export async function keep(app: App, report: { kind: string; about?: string; content: string; model?: string; usr?: number; agent?: number; session?: number }) {
  const { kind } = report, about = report.about?.trim().slice(0, 255) ?? "", content = report.content.trim();
  const model = report.model?.trim().slice(0, 255) || null, session = report.session ?? null;
  const again = session && await app.db.one`SELECT id FROM ai_agent_feedback
    WHERE session_id = ${session} AND kind = ${kind} AND about = ${about} AND content = ${content}`;
  if (again) return { id: Number(again) };
  return {
    id: Number(await app.db.table("ai_agent_feedback").insert({
      time: unixTime(), usr_id: report.usr ?? null, agent_id: report.agent ?? null, session_id: session, model, kind, about, content,
    })),
  };
}

// Anyone signed in may report, e.g. an AI through MCP; reading it is the backend's.
export const api: ApiTree = {
  post: {
    description: DESCRIPTION,
    access: Access.USER,
    input,
    execute: ({ kind, about, content, model }: { kind: string; about?: string; content: string; model?: string }, ctx: Ctx) =>
      keep(ctx.app, { kind, about, content, model, usr: ctx.userId }),
  },
};
