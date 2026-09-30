// deno-lint-ignore-file no-explicit-any
import { Ctx, s, Usr } from "@qino/qino";

import { Node } from "./Node.ts";

import type { EventDecls, EventsOf, StandardSchema } from "@qino/qino";

// annotated: Node and CMS reference each other
const node: StandardSchema<Node> = s.instance(Node).describe("The node.");

/** Events of the cms. */
export const cmsEvents = {
  "node:construct": { description: "A node was loaded.", data: s.object({ node }) },
  "node:access": {
    description: "What may this user do with the node? Module axis on top of the node's own access.",
    data: s.object({
      node,
      user: s.optional(s.instance(Usr).describe("The user, none when anonymous.")),
      access: s.number().describe("0 none, 1 read, 2 write, 3 admin; set to change it."),
    }),
  },
  "module:access": {
    description: "What may this user do with the module? Module axis, without a node.",
    data: s.object({
      module: s.string().describe("The module's name."),
      user: s.optional(s.instance(Usr).describe("The user, none when anonymous.")),
      access: s.number().describe("0 none, 1 read, 2 write, 3 admin (insertable); set to change it."),
    }),
  },
  "node:render-fallback": {
    description: "The node's module has no render function; set one.",
    data: s.object({ node, render: s.any().describe("Set to a render function (node, { ctx, vars }).") }),
  },
  "node:children": {
    description: "A node's child rows were read; change them to add or hide children.",
    data: s.object({ node, rows: s.array(s.record<any>()).describe("The child rows, from the page table.") }),
  },
  "page:render-after": {
    description: "A page's content is rendered, before the document is sent.",
    data: s.object({ ctx: s.instance(Ctx).describe("The request.") }),
  },
} satisfies EventDecls;

/** Payloads of the cms events. */
export type CmsEvents = EventsOf<typeof cmsEvents>;
