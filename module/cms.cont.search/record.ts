import { grant, html } from "@qino/qino";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

/** A signed entry follows one search while typing; only its session and search node may update it. */
export async function record(node: Node, ctx: Ctx, search: string, hits: number, vars: Record<string, unknown>) {
  const table = ctx.app.db.table("cms_search");
  const data = { node_id: node.id, log_id: await ctx.logId, search, lang: ctx.lang, hits };
  let id = Number(vars.entry);
  const resource = (id: number) => `cms.cont.search:${node.id}:${id}`;
  // update answers undefined when no row matched: then it is a new entry
  const own = Number.isSafeInteger(id) && id > 0 && grant.verify(ctx.sess, resource(id), vars) === "ok";
  if (!own || await table.update(id, data) === undefined) id = Number(await table.insert(data));
  const token = { entry: id, ...grant.sign(ctx.sess, resource(id)) };
  return html`<span hidden data-search-entry="${JSON.stringify(token)}"></span>`;
}
