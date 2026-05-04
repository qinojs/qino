// deno-lint-ignore-file no-explicit-any
import * as GitService from "./lib/GitService.ts";
import { fromFileUrl } from "../../deps.ts";
import { s } from "../core/lib/schema.ts";
import type { App } from "../core/server.ts";

export const name = "git";
export const needs: string[] = [];

export { GitService };

export async function getModuleGitInfo(app: any, moduleName: string): Promise<{ gitRoot: string | null; info: Awaited<ReturnType<typeof GitService.getStatus>> | null }> {
  const modPath = app.modules.get(moduleName)?.path;
  if (!modPath) return { gitRoot: null, info: null };
  const dir = modPath.replace(/\/?[^/]+$/, "");
  const gitRoot = await GitService.findGitRoot(dir);
  if (!gitRoot) return { gitRoot: null, info: null };
  const info = await GitService.getStatus(gitRoot);
  return { gitRoot, info };
}

export async function addModule(app: any, modulePath: string): Promise<void> {
  const absPath = modulePath.startsWith("file:") ? fromFileUrl(modulePath) : modulePath;
  await app.modules.add(absPath);
}

// todo, nur access wenn auf backend module seite access
export const api = {
  git: {
    status: {
      get: {
        input: s.object({ module: s.string() }),
        execute: async (params: any, ctx: any) => {
          const { gitRoot, info } = await getModuleGitInfo(ctx.app, params.module);
          return { gitRoot, ...info };
        },
      },
    },
    log: {
      get: {
        input: s.object({ module: s.string(), limit: s.optional(s.number()) }),
        execute: async (params: any, ctx: any) => {
          const { gitRoot } = await getModuleGitInfo(ctx.app, params.module);
          if (!gitRoot) throw new Error("Kein Git-Repo gefunden");
          return await GitService.getLog(gitRoot, params.limit ?? 20);
        },
      },
    },
    tags: {
      get: {
        input: s.object({ module: s.string() }),
        execute: async (params: any, ctx: any) => {
          const { gitRoot } = await getModuleGitInfo(ctx.app, params.module);
          if (!gitRoot) throw new Error("Kein Git-Repo gefunden");
          return await GitService.getTags(gitRoot);
        },
      },
    },
    pull: {
      post: {
        input: s.object({ module: s.string() }),
        execute: async (params: any, ctx: any) => {
          if (!ctx?.user) throw new Error("Nicht eingeloggt");
          const { gitRoot } = await getModuleGitInfo(ctx.app, params.module);
          if (!gitRoot) throw new Error("Kein Git-Repo gefunden");
          const output = await GitService.pull(gitRoot);
          return { output };
        },
      },
    },
    push: {
      post: {
        input: s.object({ module: s.string() }),
        execute: async (params: any, ctx: any) => {
          if (!(await ctx?.user?.get("superuser"))) throw new Error("Superuser erforderlich");
          const { gitRoot } = await getModuleGitInfo(ctx.app, params.module);
          if (!gitRoot) throw new Error("Kein Git-Repo gefunden");
          const output = await GitService.push(gitRoot);
          return { output };
        },
      },
    },
    checkout: {
      post: {
        input: s.object({ module: s.string(), ref: s.string() }),
        execute: async (params: any, ctx: any) => {
          if (!(await ctx?.user?.get("superuser"))) throw new Error("Superuser erforderlich");
          const { gitRoot } = await getModuleGitInfo(ctx.app, params.module);
          if (!gitRoot) throw new Error("Kein Git-Repo gefunden");
          const output = await GitService.checkout(gitRoot, params.ref);
          return { output };
        },
      },
    },
    install: {
      post: {
        input: s.object({ gitUrl: s.string(), targetDir: s.optional(s.string()) }),
        execute: async (params: any, ctx: any) => {
          if (!(await ctx?.user?.get("superuser"))) throw new Error("Superuser erforderlich");
          const app = ctx.app;
          const basePath = app.appPATH + "privat-module/";
          const repoName = params.gitUrl.split("/").pop()?.replace(/\.git$/, "") ?? "module";
          const targetDir = params.targetDir ?? (basePath + repoName);
          await GitService.clone(params.gitUrl, targetDir);

          const modFile = targetDir + "/mod.ts";
          try { await app.modules.add(modFile); }
          catch { await app.modules.add(targetDir + "/mod.js"); }

          return { installed: repoName, path: targetDir };
        },
      },
    },
  },
};

export function init(app: App): void {
  (app as any).aptTree.git = api.git;
}
