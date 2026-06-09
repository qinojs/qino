// Public API of cms. The qino plugin lives in ./plugin.ts.

import { CMS } from "./lib/CMS.ts";
import { CmsContext } from "./lib/CmsContext.ts";
import { RequestContext } from "../core/mod.ts";

declare module "../core/lib/App.ts" {
  interface App { cms: CMS; }
}

declare module "../core/lib/RequestContext.ts" {
  interface RequestContext { readonly cms: CmsContext; }
}

// Pro-Request `ctx.cms`, lazy auf dem generischen `ctx.state` gebacken — kein Core-Feld,
// app-unabhängig (daher hier als Modul-Side-Effect, nicht in init()).
Object.defineProperty(RequestContext.prototype, "cms", {
  configurable: true,
  get(this: RequestContext): CmsContext { return (this.state.cms ??= new CmsContext()); },
});

export { CMS };
export { CmsContext } from "./lib/CmsContext.ts";
export { Node } from "./lib/Node.ts";
