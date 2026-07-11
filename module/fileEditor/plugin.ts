import * as nodeFs from "node:fs/promises";
import { Output, getCtx, type Ctx, Access, type AptTree, s, type App, type Params } from "../core/mod.ts";
import codemirrorView from "./view/codemirror.ts";

export const name = "fileEditor";

async function saveFile(ctx: Ctx, file: string, content: string): Promise<number> {
  ctx.app.assertAllowedPath(file);
  const allowed = ctx.sess.data.fileEditor.allow[file]();
  if (!allowed && !(await ctx.user?.get('superuser'))) return 0;

  const backupName = `fileEditorBackup_${encodeURIComponent(file)}_${Date.now()}`;
  const backupDir = ctx.app.appPATH + "cache/tmp/pri/";
  await nodeFs.mkdir(backupDir, { recursive: true }).catch(() => {});
  await nodeFs.copyFile(file, backupDir + backupName).catch(() => {});
  await nodeFs.writeFile(file, content);
  return 1;
}

export const api: AptTree = {
  save: {
    put: {
      description: "Save file from the file editor.",
      access: Access.USER,
      input: s.object({ file: s.string(), content: s.string() }),
      execute: ({ file, content }: Params, ctx: Ctx) => saveFile(ctx, String(file), String(content)),
    },
  },
};

function editorFile(): string | null {
  const ctx = getCtx();
  const file = ctx.req.query.file;
  return file && ctx.req.appPath.startsWith("editor") ? file : null;
}

export function init(app: App) {
  app.on("action", async () => {
    const file = editorFile();
    if (!file) return;
    const ctx = getCtx();
    ctx.app.assertAllowedPath(file);

    const allowed = ctx.sess.data.fileEditor.allow[file]();
    const isSuperuser = Boolean(await ctx.user?.get('superuser'));
    if (!allowed && !isSuperuser) {
      ctx.res.headers.set("Content-Type", "text/plain; charset=utf-8");
      throw new Output("no access");
    }

    const stat = await nodeFs.stat(file).catch(() => null);
    if (!stat?.isFile()) {
      ctx.res.headers.set("Content-Type", "text/plain; charset=utf-8");
      throw new Output("file does not exist");
    }
  });

  app.on("render", async () => {
    const file = editorFile();
    if (!file) return;
    getCtx().res.html.content = await codemirrorView(file);
  });
}
