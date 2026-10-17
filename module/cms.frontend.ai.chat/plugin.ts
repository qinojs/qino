import { Access, s } from "@qino/qino";
import { Agent } from "@qino/qino/ai.agent";
import { cms, cmsCtx } from "@qino/qino/cms";
import { allowMarkdown } from "@qino/qino/cms.backend.ai";

import manifest from "./manifest.json" with { type: "json" };

import type { ApiTree, App, Ctx } from "@qino/qino";

const { name } = manifest;
const AGENT = `${name}/assistant`; // agents/assistant.md, declared by ai.agent

export const ctxSettingsSchema = {
  properties: {
    session: { type: "integer", description: "The user's session with the site assistant, to go on with." },
  },
};

/** The user's session with the assistant: the kept one, else (or with `fresh`) a new one, kept from now on. */
async function session(ctx: Ctx, fresh = false): Promise<{ id: number }> {
  const db = ctx.app.db, kept = Number(await ctx.settings[name].session) || 0;
  const owner = kept && Number(await db.one`SELECT usr_id FROM ai_session WHERE id = ${kept}`);
  if (!fresh && kept && owner === ctx.userId) return { id: kept };
  const agent = Number(await db.one`SELECT id FROM ai_agent WHERE name = ${AGENT}`);
  if (!agent) throw new Error(`No agent ${AGENT}`);
  const { id } = await new Agent(ctx.app, agent).start(ctx.userId);
  await ctx.settings[name].session(id);
  return { id };
}

/** What changed on `page` since the change `after` (cms's node_changed), each with where it hangs; and
 *  the last change, to go on from. Without `after`, only the last. */
async function changed(ctx: Ctx, page: number, after?: number) {
  if (await (await cms(ctx.app).node(page)).access() < 2) return { last: 0, nodes: [] };
  const db = ctx.app.db, last = Number(await db.one`SELECT MAX(id) FROM node_changed`) || 0;
  if (after == null) return { last, nodes: [] };
  const nodes = await db.query`SELECT DISTINCT n.node_id AS id, p.basis
    FROM node_changed n LEFT JOIN page p ON p.id = n.node_id
    WHERE n.page_id = ${page} AND n.id > ${after} AND n.id <= ${last}`;
  return { last, nodes: nodes.map((n) => ({ id: Number(n.id), basis: n.basis == null ? undefined : Number(n.basis) })) };
}

export const api: ApiTree = {
  changed: {
    get: {
      description: "What changed on a page since a change: the nodes, each with its parent (none when deleted), " +
        "and the last change.",
      access: Access.USER,
      input: s.object({ page: s.number(), after: s.optional(s.number()) }),
      execute: ({ page, after }: { page: number; after?: number }, ctx: Ctx) => changed(ctx, page, after),
    },
  },
  session: {
    get: {
      description: "Your session with the site assistant, started if there is none.",
      access: Access.USER,
      execute: (_: unknown, ctx: Ctx) => session(ctx),
    },
    post: {
      description: "Start a new session with the site assistant; it is kept from now on.",
      access: Access.USER,
      execute: (_: unknown, ctx: Ctx) => session(ctx, true),
    },
  },
};

/** The chat is an item of the CMS panel, which is there in editmode, for those who may edit the page. */
export function init(app: App, { signal }: { signal: AbortSignal }): void {
  cms(app).on("page:render-after", async ({ ctx }) => {
    const node = cmsCtx(ctx).mainNode;
    if (ctx.req.query.cms_noFrontend || !cmsCtx(ctx).editmode || !ctx.userId || !node || await node.access() < 2) return;
    const qino = ctx.res.html.jsData.qino ??= {};
    qino[name] = { page: node.id, editmode: !!cmsCtx(ctx).editmode };
    ctx.res.html.scripts.add(ctx.req.moduleUrl + name + "/pub/chat.js");
    allowMarkdown(); // answers render as markdown
  }, { signal });
}
