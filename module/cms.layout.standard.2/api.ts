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

const codeFile = (key: "html" | "css", label: string) => ({
  get: {
    description: `Read the app-wide layout ${label}; a missing file returns its starting point.`,
    ...LAYOUT_WRITE,
    output: content,
    execute: async ({ node }: { node: Node }) => ({ content: await codeFiles(node).read(key) }),
  },
  put: {
    description: `Save the app-wide layout ${label}. Read it first.`,
    ...LAYOUT_WRITE,
    input: content,
    output: s.string().describe("Rendered HTML of the page after saving"),
    execute: async ({ node, content }: { node: Node; content: string }, ctx: Ctx) => {
      const file = codeFiles(node)[key];
      await fs.mkdir(file.replace(/[^/]+$/, ""));
      await fs.write(file, content);
      ctx.app.assetRev = Math.max(unixTime(), ctx.app.assetRev + 1); // the css lives under pub/, so its url has to change
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
        html: codeFile("html", "HTML template"),
        css: codeFile("css", "CSS"),
      },
    },
  },
};
