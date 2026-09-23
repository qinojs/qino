import { getCtx } from "@qino/qino";

import { sign } from "./lib/sign.ts";

/** Editor URL for a file; allows this session to open and save it. The URL is the permission, so
 *  only create it for users who may edit the file. Undefined if the module isn't linked or the path
 *  is outside the app/module roots. */
export function editorUrl(file: string, pos: { line?: unknown; col?: unknown } = {}): string | undefined {
  const ctx = getCtx();
  if (!ctx.app.modules.linked("fileEditor")) return;
  try { ctx.app.assertAllowedPath(file); } catch { return; }
  const params = new URLSearchParams({ file, ...sign(ctx, file) });
  if (pos.line != null) params.set("line", String(pos.line));
  if (pos.col  != null) params.set("col",  String(pos.col));
  return ctx.req.appUrl + "fileEditor?" + params;
}
