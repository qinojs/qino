// Public API of cms.cont.ts. The qino plugin lives in ./plugin.ts.

import type { Node } from "../cms/mod.ts";
import type { Ctx, html } from "../core/mod.ts";

/** What a node file default-exports. `html` is handed over so files outside the project need no import of it. */
export type NodeRender = (node: Node, opt: { ctx: Ctx; vars: Record<string, unknown>; html: typeof html }) => unknown;
