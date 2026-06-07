import * as GitService from "./lib/GitService.ts";
import type { App } from "../core/mod.ts";

export { GitService };

export async function getModuleGitInfo(app: App, moduleName: string): Promise<{ gitRoot: string | null; info: Awaited<ReturnType<typeof GitService.getStatus>> | null }> {
  const modPath = app.modules.get(moduleName)?.path;
  if (!modPath) return { gitRoot: null, info: null };
  const dir = modPath.replace(/\/?[^/]+$/, "");
  const gitRoot = await GitService.findGitRoot(dir);
  if (!gitRoot) return { gitRoot: null, info: null };
  const info = await GitService.getStatus(gitRoot);
  return { gitRoot, info };
}
