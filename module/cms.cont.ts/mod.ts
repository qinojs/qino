import type { Ctx, html } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

/** A node file's default export. `html` is passed in, so files outside the project need no import. */
export type NodeRender = (node: Node, opt: { ctx: Ctx; vars: Record<string, unknown>; html: typeof html }) => unknown;
