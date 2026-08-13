// Public API of cms.cont.ts. The qino plugin lives in ./plugin.ts.
import type { Ctx, html } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

/** What a node file default-exports. `html` is handed over so files outside the project need no import of it. */
export type NodeRender = (node: Node, opt: { ctx: Ctx; vars: Record<string, unknown>; html: typeof html }) => unknown;
