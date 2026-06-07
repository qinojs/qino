// Public API of cms. The qino plugin lives in ./plugin.ts.

import { CMS } from "./lib/CMS.ts";

declare module "../core/lib/App.ts" {
  interface App { cms: CMS; }
}

export { CMS };
export { Node } from "./lib/Node.ts";
