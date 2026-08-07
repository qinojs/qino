import * as nodeFs from "node:fs/promises";
import { Output, getCtx, type Ctx, Access, type ApiTree, s, type App, type Params } from "../core/mod.ts";
import codemirrorView from "./view/codemirror.ts";
import { check } from "./lib/sign.ts";

export const name = "fileEditor";
export const description = "Provides an access-controlled browser editor for application files.";

// A stale link is an everyday event; a mac that never matched this session's key is
// someone trying, so it gets reported. Superusers pass without a signature at all.
async function allowed(ctx: Ctx, file: string, exp: unknown, sig: unknown): Promise<boolean> {
  if (await ctx.user?.get("superuser")) return true;
  const state = check(ctx, file, exp, sig);
  if (state !== "ok" && state !== "expired") {
    ctx.app.fire("suspicious", { ctx, weight: state === "forged" ? 3 : 1, reason: `fileEditor ${state} request` }).catch(() => {});
  }
  return state === "ok";
}

async function saveFile(ctx: Ctx, file: string, content: string, exp: unknown, sig: unknown): Promise<number> {
  ctx.app.assertAllowedPath(file);
  if (!await allowed(ctx, file, exp, sig)) return 0;

  const backupName = `fileEditorBackup_${encodeURIComponent(file)}_${Date.now()}`;
  const backupDir = ctx.app.modules.get(name)!.tmp;
  await nodeFs.mkdir(backupDir, { recursive: true }).catch(() => {});
  await nodeFs.copyFile(file, backupDir + backupName).catch(() => {});
  await nodeFs.writeFile(file, content);
  return 1;
}

export const api: ApiTree = {
  save: {
    put: {
      description: "Save file from the file editor.",
      access: Access.USER,
      input: s.object({ file: s.string(), content: s.string(), exp: s.optional(s.string()), sig: s.optional(s.string()) }),
      execute: ({ file, content, exp, sig }: Params, ctx: Ctx) => saveFile(ctx, String(file), String(content), exp, sig),
    },
  },
};

function editorFile(): string | null {
  const ctx = getCtx();
  const file = ctx.req.query.file;
  return file && ctx.req.appPath === name ? file : null;
}

export function init(app: App, { signal }: { signal: AbortSignal }) {
  app.on("route", async ({ ctx }) => {
    const file = editorFile();
    if (!file) return;
    ctx.app.assertAllowedPath(file);

    if (!await allowed(ctx, file, ctx.req.query.exp, ctx.req.query.sig)) throw new Output("no access");
    if (!(await nodeFs.stat(file).catch(() => null))?.isFile()) throw new Output("file does not exist");
  }, { signal });

  app.on("render", async () => {
    const file = editorFile();
    if (!file) return;
    getCtx().res.html.content = await codemirrorView(file);
  }, { signal });
}
