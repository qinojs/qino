import { Access, ConflictError, NotFoundError, fs, s, unixTime } from "@qino/qino";
import { cms, WRITE } from "@qino/qino/cms";

import { codeFiles } from "./codeFiles.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { ApiTree, Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const content = s.object({ content: s.string().describe("Complete file content") });
const LAYOUT_WRITE = {
  access: Access.USER,
  guard: async ({ node }: { node: Node }, ctx: Ctx) => {
    const layout = await node.cms.layoutPage(manifest.name);
    return await layout.access(ctx.user) >= WRITE;
  },
};

const codeFile = (key: "src" | "css" | "js", label: string) => ({
  get: {
    description: `Open the app-wide layout ${label}, with the shipped starting point.`,
    ...LAYOUT_WRITE,
    output: content,
    execute: async ({ node }: { node: Node }) => {
      const files = codeFiles(node);
      await files.create(key);
      return { content: await fs.text(files[key]) };
    },
  },
  put: {
    description: `Save the app-wide layout ${label}. Open first to inspect the starting point.`,
    ...LAYOUT_WRITE,
    input: content,
    output: s.string().describe("Rendered HTML of the page after saving"),
    execute: async ({ node, content }: { node: Node; content: string }, ctx: Ctx) => {
      const files = codeFiles(node);
      await fs.mkdir(`${node.module!.data}pub/`);
      await fs.write(files[key], content);
      ctx.app.assetRev = Math.max(unixTime(), ctx.app.assetRev + 1);
      return String(await node.html());
    },
  },
});

export const api: ApiTree = {
  node: {
    ":node": {
      paramSchema: s.number().describe(`ID of a page using ${manifest.name}; files are shared by the layout`),
      resolve: async (id: number, ctx: Ctx) => {
        const node = await cms(ctx.app).node(id);
        if (!node.exists()) throw new NotFoundError(`Node ${id} not found`);
        if (node.vs.module !== manifest.name) throw new ConflictError(`Node ${id} does not use ${manifest.name}`);
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
