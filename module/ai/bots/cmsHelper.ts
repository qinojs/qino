import type { Bot, ClientContext } from "../types.ts";
import { toTools } from "../../core/lib/apt.ts";
import { api as cmsApi } from "../../cms/apt.ts";

const renames: Record<string, string> = {
  getNodes: "searchNodes",
  getNodeContents: "getContentBlocks",
  createNodeChildren: "createChildNode",
  createNodeContents: "createContentBlock",
  setNodeSettings: "setNodeSettings",
  createNodeFiles: "addNodeFile",
  setTxt: "setInlineText",
  setNodePosition: "moveNode",
};

const cmsTools = toTools(cmsApi, {
  apis: {
    "/nodes": ["get"],
    "/node/:node": ["get", "delete"],
    "/node/:node/sitemap": ["get"],
    "/node/:node/children": ["post"],
    "/node/:node/contents": ["get", "post"],
    "/node/:node/title": ["put"],
    "/node/:node/text/:name": ["put"],
    "/txt/:id": ["put"],
    "/node/:node/module": ["put"],
    "/node/:node/settings": ["get", "put"],
    "/node/:node/files": ["get", "post"],
    "/node/:node/visible": ["put"],
    "/node/:node/position": ["put"],
  }
}).map((t) => {
  t.name = renames[t.name] ?? t.name;
  return t;
});

const CMS_CONTEXT = `
You are an assistant embedded in Vanilla CMS.
Use the user's language. Be concise, practical, and use tools for CMS changes.

## CMS essentials

- Frontend-editing.
- Pages and content blocks are nodes.
- Page layouts render named content areas, usually "main". Rendered page content is normally inside "cms.cont.flexible" blocks.
- A "cms.cont.flexible" block is a container for arbitrary content blocks.
- Normal content blocks directly below a page may not be visible. Add content inside a flexible block.

## UI (panel is right)

- Struktur: page tree; right-click nodes to create, rename, move, delete.
- Einstellungen: URL/slug, access, SEO, visibility, time restrictions.
- Module: add content block types such as text, image, table.

## Tool usage

- "current page" means the Current node from context.
- Use getNodeSitemap only for the page tree.
- Before editing or adding page content, call getContentBlocks.
- For new content, choose a "cms.cont.flexible" target:
  1. If the Current node is "cms.cont.flexible", insert there.
  2. Otherwise inspect the current page and insert into an existing flexible block, preferably named "main" or below named "main".
  3. If several targets are plausible or no flexible target exists, ask one short clarification.
- Use createContentBlock with modules such as "cms.cont.text", "cms.cont.image2", "cms.cont.table2", "cms.cont.nav3", or "cms.cont.login4".
- Text block: after creation, setNodeText on the new node with name "main".
- Image block: addNodeFile; alt text uses setNodeText name "main".
- Table block: setNodeSettings for dimensions; edit cells with setNodeText names like "0_0", "0_1", "1_0".
- If the frontend gives a cmstxt/text-id, use setInlineText.
`.trim();

export const CmsHelperBot: Bot = {
  id: "cms-helper",
  systemPrompt: async (ctx: unknown, clientContext: ClientContext): Promise<string> => {
    const { user } = ctx as { user?: { get(k: string): Promise<string> } };
    const lines: string[] = [CMS_CONTEXT];
    if (user) {
      const name = await user.get("firstname");
      if (name) lines.push(`\nCurrent user: ${name}`);
    }
    if (clientContext.page) {
      const page = clientContext.page as Record<string, unknown>;
      const parts: string[] = [];
      if (page.id) parts.push(`page-id (node-id): ${page.id}`);
      if (page.title) parts.push(`title: "${page.title}"`);
      if (page.module) parts.push(`module: ${page.module}`);
      if (page.url) parts.push(`url: ${page.url}`);
      if (parts.length) lines.push(`Current node: ${parts.join(", ")}`);
    }

    if (clientContext.extra) {
      lines.push(
        `\nAdditional context: ${JSON.stringify(clientContext.extra)}`,
      );
    }
    return lines.join("\n");
  },
  tools: cmsTools,
  chatSchema: {
    type: "object",
    properties: {
      response: { type: "string", description: "The answer to show the user" },
      relevance: {
        type: "number",
        min: 0,
        max: 10,
        description: "How relevant is this question for your memory.",
      },
      issue: {
        description: "If anything in this conversation reveals improvement potential — e.g. something didn't work, was misunderstood, lacked context, or the bot was missing tools or knowledge — describe it. Otherwise null.",
        type: "object",
        properties: {
          description: { type: "string" },
          severity: { type: "string", enum: ["low", "medium", "high"] },
        },
        required: ["description", "severity"],
      },
    },
    required: ["response", "relevance"],
  },
};
