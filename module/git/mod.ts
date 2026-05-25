import * as GitService from "./lib/GitService.ts";
import { fromFileUrl } from "../../deps.ts";
import { s } from "../core/lib/StandardSchema.ts";
import { Access } from "../core/lib/apt/mod.ts";
import type { App } from "../core/server.ts";
import type { RequestContext } from "../core/lib/RequestContext.ts";
import type { Params } from "../core/lib/apt/types.ts";

export const name = "git";
export const needs: string[] = [];

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

export async function addModule(app: App, modulePath: string): Promise<void> {
  const absPath = modulePath.startsWith("file:") ? fromFileUrl(modulePath) : modulePath;
  await (app.modules as unknown as { add(p: string): Promise<void> }).add(absPath);
}

export const api = {
  git: {
    status: {
      get: {
        input: s.object({ module: s.string() }),
        access: Access.SUPERUSER,
        execute: async (params: Params, ctx: RequestContext) => {
          const { gitRoot, info } = await getModuleGitInfo(ctx.app, String(params.module));
          return { gitRoot, ...info };
        },
      },
    },
    log: {
      get: {
        query: s.object({ module: s.string(), limit: s.optional(s.number()) }),
        access: Access.SUPERUSER,
        execute: async (params: Params, ctx: RequestContext) => {
          const { gitRoot } = await getModuleGitInfo(ctx.app, String(params.module));
          if (!gitRoot) throw new Error("Kein Git-Repo gefunden");
          return GitService.getLog(gitRoot, Number(params.limit ?? 20));
        },
      },
    },
    tags: {
      get: {
        input: s.object({ module: s.string() }),
        access: Access.SUPERUSER,
        execute: async (params: Params, ctx: RequestContext) => {
          const { gitRoot } = await getModuleGitInfo(ctx.app, String(params.module));
          if (!gitRoot) throw new Error("Kein Git-Repo gefunden");
          return GitService.getTags(gitRoot);
        },
      },
    },
    pull: {
      post: {
        input: s.object({ module: s.string() }),
        access: Access.SUPERUSER,
        execute: async (params: Params, ctx: RequestContext) => {
          const { gitRoot } = await getModuleGitInfo(ctx.app, String(params.module));
          if (!gitRoot) throw new Error("Kein Git-Repo gefunden");
          const output = await GitService.pull(gitRoot);
          return { output };
        },
      },
    },
    push: {
      post: {
        input: s.object({ module: s.string() }),
        access: Access.SUPERUSER,
        execute: async (params: Params, ctx: RequestContext) => {
          const { gitRoot } = await getModuleGitInfo(ctx.app, String(params.module));
          if (!gitRoot) throw new Error("Kein Git-Repo gefunden");
          const output = await GitService.push(gitRoot);
          return { output };
        },
      },
    },
    checkout: {
      post: {
        input: s.object({ module: s.string(), ref: s.string() }),
        access: Access.SUPERUSER,
        execute: async (params: Params, ctx: RequestContext) => {
          const { gitRoot } = await getModuleGitInfo(ctx.app, String(params.module));
          if (!gitRoot) throw new Error("Kein Git-Repo gefunden");
          const output = await GitService.checkout(gitRoot, String(params.ref));
          return { output };
        },
      },
    },
    install: {
      post: {
        input: s.object({ gitUrl: s.string(), targetDir: s.optional(s.string()) }),
        access: Access.SUPERUSER,
        execute: async (params: Params, ctx: RequestContext) => {
          const app = ctx.app;
          const basePath = app.appPATH + "privat-module/";
          const gitUrl = String(params.gitUrl);
          const repoName = gitUrl.split("/").pop()?.replace(/\.git$/, "") ?? "module";
          const targetDir = String(params.targetDir ?? (basePath + repoName));
          await GitService.clone(gitUrl, targetDir);

          const modFile = targetDir + "/mod.ts";
          const modulesAdd = (app.modules as unknown as { add(p: string): Promise<void> }).add.bind(app.modules);
          try { await modulesAdd(modFile); }
          catch { await modulesAdd(targetDir + "/mod.js"); }

          return { installed: repoName, path: targetDir };
        },
      },
    },
  },
};

export function init(app: App): void {
  app.aptTree.git = api.git;
}
