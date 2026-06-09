import { GitService, getModuleGitInfo } from "./mod.ts";
import { s, Access, type App, type RequestContext, type Params } from "../core/mod.ts";

export const name = "git";
export const needs: string[] = [];

export async function addModule(app: App, modulePath: string): Promise<void> {
  await app.modules.import(modulePath);
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

          for (const file of ["plugin.ts", "plugin.js", "plugin.mjs"]) {
            const path = targetDir + "/" + file;
            try { if (!(await Deno.stat(path)).isFile) continue; }
            catch (e) {
              if (e instanceof Deno.errors.NotFound) continue;
              throw e;
            }
            await app.modules.import(path);
            return { installed: repoName, path: targetDir };
          }
          throw new Error(`No plugin file found in ${targetDir}`);
        },
      },
    },
  },
};

export function init(app: App): void {
  app.aptTree.git = api.git;
}
