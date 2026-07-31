// Public API of fileEditor. The qino plugin lives in ./plugin.ts.

import { getCtx } from "../core/mod.ts";

/** Editor URL for a file, allowing the current session to open and save it. */
export function editorUrl(file: string): string {
  const ctx = getCtx();
  ctx.sess.data.fileEditor.allow[file](1);
  return ctx.req.basePath + "editor?file=" + encodeURIComponent(file);
}
