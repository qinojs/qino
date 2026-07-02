import type { Node } from "./Node.ts";

// Per-request CMS context, installed on `ctx.cms` by the cms module (see plugin.ts).
// Lives on the request object because the data is per-request — no app-singleton
// detour (formerly `app.cms.MainNode` via getCtx). Core does not know about cms.
export class CmsContext {
  mainNode!: Node;
  requestedNode!: Node;
  editmode = 0;
  renderPath: Set<number> = new Set();
  accessCache: Record<string, number> = {};
  get nodeId(): number | undefined { return this.mainNode?.id; }
  get requestedNodeId(): number | undefined { return this.requestedNode?.id; }
}
