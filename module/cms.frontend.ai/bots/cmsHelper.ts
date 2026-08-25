import { toTools } from "@qino/qino";

import { api as cmsApi } from "../../cms/api.ts";

import type { Usr } from "@qino/qino";
import type { Bot, ClientContext } from "@qino/qino/ai";

const cmsTools = toTools(cmsApi, {
  apis: {
    "/nodes": ["get"],
    "/node/:node": ["get", "delete", "patch"],
    "/node/:node/sitemap": ["get"],
    "/node/:node/children": ["post"],
    "/node/:node/contents": ["get", "post"],
    "/node/:node/copy": ["post"],
    "/node/:node/title": ["put"],
    "/node/:node/text/:name": ["put"],
    "/txt/:id": ["put"],
    "/node/:node/module": ["put"],
    "/node/:node/settings": ["get", "put"],
    "/node/:node/files": ["get", "post"],
    "/node/:node/insert-before": ["put"],
  }
});

const CMS_CONTEXT = `
You are an assistant embedded in qino CMS.
Use the user's language. Be concise, practical, and use tools for CMS changes.

## CMS essentials

- Frontend-editing.
- Pages and content blocks are nodes.
- Page layouts render named content areas, usually "main". Rendered page content is normally inside "cms.cont.flexible" blocks.
- A "cms.cont.flexible" block is a container for arbitrary content blocks.
- Normal content blocks directly below a page may not be visible. Add content inside a flexible block.

## UI (panel is right)

- Structure: page tree; right-click nodes to create, rename, move, delete.
- Settings: URL/slug, access, SEO, visibility, time restrictions.
- Module: add content block types such as text, image, table.

## Tool usage

- The Current node from context is the default target.
- Use get_node_contents before content edits. Insert new blocks with post_node_contents into a cms.cont.flexible target; if no clear target exists, ask one short clarification.
- Common block modules: cms.cont.text, cms.cont.image2, cms.cont.table2, cms.cont.nav3, cms.cont.login4.
- Text/alt/cell content uses put_node_text (usually name "main"; table cells use "0_0", "0_1", ...). Inline cmstxt/text-id uses put_txt.
- Files use post_node_files. Settings use put_node_settings. Copies use post_node_copy.
`.trim();

export const cmsHelper: Bot = {
  id: "cms-helper",
  systemPrompt: async (ctx: unknown, clientContext: ClientContext): Promise<string> => {
    const { user } = ctx as { user?: Usr };
    const lines = [CMS_CONTEXT];
    if (user) {
      const name = user.given_name;
      if (name) lines.push(`\nCurrent user: ${name}`);
    }
    if (clientContext.page) {
      const page = clientContext.page as Record<string, unknown>;
      const parts = [];
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
};
