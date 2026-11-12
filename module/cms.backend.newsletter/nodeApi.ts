import { preview } from "./render.ts";

import type { Node } from "@qino/qino/cms";

/** Node access is the permission — the preview renders, it stores nothing. */
export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  if (!vars.preview) return null;
  const { text, template } = vars.preview as Record<string, unknown>;
  return { html: await preview(node.app, { text, template: template || null }) };
}
