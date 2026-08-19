import type { Ctx } from "@qino/qino";
import type { Node } from "./Node.ts";

/** Per-request cms state, lazily created on the generic `ctx.state` — core stays cms-agnostic. */
export function cmsCtx(ctx: Ctx): CmsContext {
  return ctx.state.cms ??= new CmsContext();
}

// Per-request CMS context. Lives on the request object because the data is per-request —
// no app-singleton detour. Core does not know about cms.
export class CmsContext {
  mainNode!: Node;
  requestedNode!: Node;
  editmode = 0;
  renderPath: Set<number> = new Set();
  accessCache: Map<string, number> = new Map();
  get nodeId(): number | undefined { return this.mainNode?.id; }
  get requestedNodeId(): number | undefined { return this.requestedNode?.id; }
}
