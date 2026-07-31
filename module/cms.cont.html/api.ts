import { cms, type Node } from "../cms/mod.ts";
import { Access, ConflictError, NotFoundError, s, type AptTree, type Ctx } from "../core/mod.ts";
import { codeFiles } from "./codeFiles.ts";

const content = s.object({ content: s.string().describe("Complete file content") });
const rendered = s.string().describe("Rendered HTML of the node after saving");
const nodeWrite = {
  access: Access.USER,
  guard: ({ node }: { node: Node }, ctx: Ctx) => node.access(ctx.user).then((access) => access >= 2),
};

const codeFile = (key: "src" | "css" | "js", label: string) => ({
  get: {
    description: `Read the ${label} source of a cms.cont.html node`,
    ...nodeWrite,
    output: content,
    execute: async ({ node }: { node: Node }) => {
      const value = await Deno.readTextFile(codeFiles(node)[key]).catch((e) => {
        if (e instanceof Deno.errors.NotFound) throw new NotFoundError(`${label} file not found`);
        throw e;
      });
      return { content: value };
    },
  },
  put: {
    description: `Replace or create the ${label} source of a cms.cont.html node and return its rendered HTML`,
    ...nodeWrite,
    input: content,
    output: rendered,
    execute: async ({ node, content }: { node: Node; content: string }) => {
      const files = codeFiles(node);
      await Deno.mkdir(`${node.module!.appDir}pub/`, { recursive: true });
      await Deno.writeTextFile(files[key], content);
      return String(await node.html());
    },
  },
});

export function nodeApi(module: string): AptTree {
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
