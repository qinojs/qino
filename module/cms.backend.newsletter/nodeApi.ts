import { isDraft, preview, save } from "./render.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { Node } from "@qino/qino/cms";

/** Node access is the permission. `preview` renders, `save` stores a draft's fields as the editor
 *  types them. */
export default async function api(node: Node, vars: Record<string, unknown> | null): Promise<unknown> {
  const app = node.app;
  if (vars?.save) {
    const { id, ...fields } = vars.save as Record<string, unknown>;
    const issue = Number(id);
    // sent meanwhile, e.g. from another tab: the report shows what went out
    if (!await isDraft(app, issue)) throw new Error(await app.t.with(manifest.name, () => app.t`Only a draft can be changed.`));
    await save(app, issue, fields);
    return { saved: true };
  }
  if (!vars?.preview) return null;
  const { text, template } = vars.preview as Record<string, unknown>;
  return { html: await app.t.with(manifest.name, () => preview(app, { text, template: template || null })) };
}
