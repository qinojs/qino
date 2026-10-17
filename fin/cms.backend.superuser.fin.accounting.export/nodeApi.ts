import { exportBooks } from "./lib/export.ts";

import type { Node } from "@qino/qino/cms";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Node access is the permission — whoever may open this page may take the books along. */
export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  if (!vars.export) return null;
  const { from, to } = vars.export as Record<string, string>;
  if (!DATE.test(from) || !DATE.test(to)) return { ok: false, message: await node.app.t`Dates, please` };
  // a ZIP, handed over as base64 for the browser to save
  return { ok: true, name: `books-${from}-${to}.zip`, data: (await exportBooks(node.app, { from, to })).toBase64() };
}
