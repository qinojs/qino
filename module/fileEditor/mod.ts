import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import { OutputError, assertAllowedPath } from "../core/lib/util.ts"
import { getCtx, type RequestContext } from "../core/lib/RequestContext.ts";
import { Access, type AptTree } from "../core/lib/apt/mod.ts";
import { s } from "../core/lib/StandardSchema.ts";
import type { App } from "../core/server.ts";
import type { Params } from "../core/lib/apt/types.ts";
import codemirrorView from "./view/codemirror.ts";

export const name = "fileEditor";

async function saveFile(ctx: RequestContext, file: string, content: string): Promise<number> {
    assertAllowedPath(file, ctx.app);
    const allowed = ctx.session.fileEditor.allow[file]();
    if (!allowed && !(await ctx.user?.get('superuser'))) return 0;

    const backupName = `fileEditorBackup_${encodeURIComponent(file)}_${Date.now()}`;
    const backupDir = ctx.app.appPATH + "cache/tmp/pri/";
    await nodeFs.mkdir(backupDir, { recursive: true }).catch(() => {});
    await nodeFs.copyFile(file, backupDir + backupName).catch(() => {});
    await nodeFs.writeFile(file, content);
    return 1;
}

const api: AptTree = {
    save: {
        put: {
            description: "Save file from the file editor.",
            access: Access.USER,
            input: s.object({ file: s.string(), content: s.string() }),
            execute: ({ file, content }: Params, ctx: RequestContext) => saveFile(ctx, String(file), String(content)),
        },
    },
};

function editorFile(): string | null {
    const ctx = getCtx();
    const file = ctx.get["file"] as string;
    return file && ctx.appRequestUri.startsWith("editor") ? file : null;
}

export function init(app: App) {
    app.aptTree.fileEditor = api;

    app.on("action", async () => {
        const file = editorFile();
        if (!file) return;
        const ctx = getCtx();
        assertAllowedPath(file, ctx.app);

        const allowed = ctx.session.fileEditor.allow[file]();
        const isSuperuser = Boolean(await ctx.user?.get('superuser'));
        if (!allowed && !isSuperuser) {
            ctx.responseHeaders.set("Content-Type", "text/plain; charset=utf-8");
            throw new OutputError("no access");
        }

        if ("create" in ctx.get) {
            await nodeFs.mkdir(nodePath.dirname(file), { recursive: true }).catch(() => {});
            try { await nodeFs.stat(file); } catch {
                await nodeFs.writeFile(file, String(ctx.get["create"] ?? ""));
            }
        }

        const stat = await nodeFs.stat(file).catch(() => null);
        if (!stat?.isFile()) {
            ctx.responseHeaders.set("Content-Type", "text/plain; charset=utf-8");
            throw new OutputError("file does not exist");
        }
    });

    app.on("render", async () => {
        const file = editorFile();
        if (!file) return;
        getCtx().html.content = await codemirrorView(file);
    });
}
