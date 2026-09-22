import { Access, ConflictError, NotFoundError, isFile, s, unixTime } from "@qino/qino";
import { cms } from "@qino/qino/cms";

import { codeFiles } from "./codeFiles.ts";

import type { ApiTree, Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const content = s.object({ content: s.string().describe("Complete file content") });
const rendered = s.string().describe("Rendered HTML of the node after saving");
const NODE_WRITE = {
  access: Access.USER,
  guard: ({ node }: { node: Node }, ctx: Ctx) => node.access(ctx.user).then((access) => access >= 2),
};

const codeFile = (key: "src" | "css" | "js", label: string) => ({
  get: {
    description: `Open the ${label}, with examples for new nodes.`,
    ...NODE_WRITE,
    output: content,
    execute: async ({ node }: { node: Node }) => {
      const files = codeFiles(node);
      await files.create(key);
      return { content: await Deno.readTextFile(files[key]) };
    },
  },
  put: {
    description: `Save the ${label}. Open first to see the examples.`,
    ...NODE_WRITE,
    input: content,
    output: rendered,
    execute: async ({ node, content }: { node: Node; content: string }, ctx: Ctx) => {
      const files = codeFiles(node);
      await files.create();
      await Deno.writeTextFile(files[key], content);
      await isFile(files[key], true);
      ctx.app.assetRev = unixTime(); // css/js live under pub/, so their url has to change
      return String(await node.html()); // tobi: does rendering node.html() for a CSS/JS file make sense, or does it only waste tokens?
    },
  },
});

export function nodeApi(module: string): ApiTree {
  return {
    node: {
      ":node": {
        paramSchema: s.number().describe(`ID of a node using the ${module} module`),
        resolve: async (id: number, ctx: Ctx) => {
          const node = await cms(ctx.app).node(id);
          if (!node.exists()) throw new NotFoundError(`Node ${id} not found`);
          if (node.vs.module !== module) throw new ConflictError(`Node ${id} does not use ${module}`);
          return node;
        },
        codefiles: {
          html: codeFile("src", "HTML template"),
          css: codeFile("css", "CSS"),
          js: codeFile("js", "JavaScript"),
        },
      },
    },
  };
}
