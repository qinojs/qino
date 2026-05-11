/**
 * fileEditor/mod.ts - File Editor module
 * Port of fileEditor/qg.php
 */

// deno-lint-ignore-file no-explicit-any

import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import { OutputError, assertAllowedPath } from "../core/lib/util.ts"
import { getCtx } from "../core/lib/RequestContext.ts";
import type { AptTree } from "../core/lib/apt.ts";
import { s } from "../core/lib/StandardSchema.ts";
import codemirrorView from "./view/codemirror.ts";

export const name = "fileEditor";

async function saveFile(ctx: any, file: string, content: string): Promise<number> {
    assertAllowedPath(file, ctx.app);
    const allowed = ctx.session.fileEditor.allow[file]();
    const usr = ctx.user;
    if (!allowed && !(await usr?.get('superuser'))) return 0;

    const now = new Date();
    const d = String(now.getDate()).padStart(2, "0");
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const Y = now.getFullYear();
    const h = String(now.getHours() % 12 || 12).padStart(2, "0");
    const i = String(now.getMinutes()).padStart(2, "0");
    const backupName = `fileEditorBackup_${encodeURIComponent(file)}_${d}${m}${Y}${h}${i}`;
    const backupDir = ctx.app.appPATH + "cache/tmp/pri/";
    await nodeFs.mkdir(backupDir, { recursive: true }).catch(() => {});
    await nodeFs.copyFile(file, backupDir + backupName).catch(() => {});
    await nodeFs.writeFile(file, content);
    return 1;
}

const api: AptTree = {
    save: {
        put: {
            description: "Datei aus dem File-Editor speichern.",
            input: s.object({ file: s.string(), content: s.string() }),
            execute: ({ file, content }: any, ctx: any) => saveFile(ctx, file, content),
        },
    },
};

export function init(app: any) {
    app.aptTree.fileEditor = api;


    app.on("action", async () => {
        const ctx = getCtx();
        const file = ctx.get["file"] as string;
        if (!file || !ctx.appRequestUri.startsWith("editor")) return;
        assertAllowedPath(file, ctx.app);

        // access check: session must have fileEditor.allow[$file] or user must be superuser
        const allowed = ctx.session.fileEditor.allow[file]();
        const usr = ctx.user;
        const isSuperuser = Boolean(await usr?.get('superuser'));

        if (!allowed && !isSuperuser) {
            ctx.responseHeaders.set("Content-Type", "text/plain; charset=utf-8");
            throw new OutputError("no access");
        }

        // create file if requested
        if (ctx.get["create"] !== undefined) {
            const dirName = nodePath.dirname(file);
            await nodeFs.mkdir(dirName, { recursive: true }).catch(() => {});
            try {
                await nodeFs.stat(file);
            } catch {
                await nodeFs.writeFile(file, String(ctx.get["create"] ?? ""));
            }
        }

        // check file exists
        let isFile = false;
        try {
            const stat = await nodeFs.stat(file);
            isFile = stat.isFile();
        } catch { /* not found */ }
        if (!isFile) {
            ctx.responseHeaders.set("Content-Type", "text/plain; charset=utf-8");
            throw new OutputError("file does not exist");
        }

        ctx.responseHeaders.set("Content-Type", "text/html; charset=utf-8");
        throw new OutputError(await codemirrorView(file));
    });
}
