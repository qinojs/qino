// Public API of fileEditor. The qino plugin lives in ./plugin.ts.

import { getCtx } from "../core/mod.ts";
import { sign } from "./lib/sign.ts";

/** Editor URL for a file, allowing the current session to open and save it.
 *  The URL is the grant — only call it where editing that file is plausible for
 *  the current user. Undefined when the module is not linked (consumers treat it
 *  as optional) or the path lies outside the app/module roots. */
export function editorUrl(file: string, pos: { line?: unknown; col?: unknown } = {}): string | undefined {
  const ctx = getCtx();
  if (!ctx.app.modules.linked("fileEditor")) return;
  try { ctx.app.assertAllowedPath(file); } catch { return; }
  const params = new URLSearchParams({ file, ...sign(ctx, file) });
  if (pos.line != null) params.set("line", String(pos.line));
  if (pos.col  != null) params.set("col",  String(pos.col));
  return ctx.req.appUrl + "fileEditor?" + params;
}
