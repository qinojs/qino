// Public API of cms. The qino plugin lives in ./plugin.ts.

import { CMS } from "./lib/CMS.ts";
import { CmsContext } from "./lib/CmsContext.ts";
import { Ctx } from "../core/mod.ts";
import type { dbEntry_usr } from "../core/mod.ts";
import type { Node } from "./lib/Node.ts";

declare module "../core/lib/App.ts" {
  interface App { cms: CMS; }
  interface AppEvents {
    "cms-ready": { ctx: Ctx };
    "page::construct": { Page: Node };
    "cms::calcAccess": { node: Node; user?: dbEntry_usr | null; access: number };
    "cms.node.render": { node: Node; render: ((node: Node, opts: Record<string, unknown>) => unknown) | null };
  }
}

declare module "../core/lib/ctx/Ctx.ts" {
  interface Ctx { readonly cms: CmsContext; }
}

// Per-request `ctx.cms`, lazily baked onto the generic `ctx.state` — no core field,
// app-independent (hence a module side effect here, not in init()).
Object.defineProperty(Ctx.prototype, "cms", {
  configurable: true,
  get(this: Ctx): CmsContext { return (this.state.cms ??= new CmsContext()); },
});

export { CMS };
export { CmsContext } from "./lib/CmsContext.ts";
export { Node } from "./lib/Node.ts";
export * from "./lib/access.ts";
export { sanitizeHtml } from "./lib/sanitize.ts";
