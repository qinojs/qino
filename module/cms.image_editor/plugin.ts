// deno-lint-ignore-file no-explicit-any

import { Output, type App, type AptTree, type RequestContext, s } from "../core/mod.ts";
import type {} from "../cms/mod.ts";
import { getHistory, getMeta, isWritable, restore, setMeta, writablePage } from "./lib/service.ts";

export const name = "cms.image_editor";
export const needs = ["cms", "cms.versions"];

// hpos/vpos focus point of an image, in percent (0–100). Versioned via the `file` table.
export const dbSchema = {
    properties: {
        file: {
            additionalProperties: {
                properties: {
                    hpos: { type: "number" },
                    vpos: { type: "number" },
                },
            },
        },
    },
};

const guard = async ({ file }: any, ctx: RequestContext) => isWritable(ctx, Number(file));

export const api: AptTree = {
    meta: {
        ":file": {
            get: {
                description: "Read editable image meta (name, hpos, vpos).",
                access: guard,
                execute: ({ file }: any, ctx: any) => getMeta(ctx, Number(file)),
            },
            put: {
                description: "Update image meta (name, hpos, vpos).",
                access: guard,
                input: s.object({
                    name: s.optional(s.string()),
                    hpos: s.optional(s.number()),
                    vpos: s.optional(s.number()),
                }),
                execute: ({ file, name, hpos, vpos }: any, ctx: any) => setMeta(ctx, Number(file), { name, hpos, vpos }),
            },
        },
    },
    history: {
        ":file": {
            get: {
                description: "Version history of an image as an HTML table.",
                access: guard,
                execute: ({ file }: any, ctx: any) => getHistory(ctx, Number(file)),
            },
        },
    },
    restore: {
        ":file": {
            post: {
                description: "Restore a previous version of an image.",
                access: guard,
                input: s.object({ log: s.number() }),
                execute: ({ file, log }: any, ctx: any) => restore(ctx, Number(file), Number(log)),
            },
        },
    },
};

export function init(app: App) {
    app.on("cms-ready", e => {
        const ctx = e.ctx as RequestContext;
        if (ctx.get.qgCmsNoFrontend) return;
        if (!ctx.cms.editmode) return;
        ctx.html.scripts.add(ctx.sysURL + "cms.image_editor/pub/init.mjs");
    });

    // Replace an existing image with the edited version (keeps the filename).
    app.on("action", async e => {
        const ctx = e.ctx as RequestContext;
        const upload = ctx.files["editedImage"];
        if (!upload) return;

        const fileId = Number(ctx.get.file_id ?? "0");
        const Page = await writablePage(ctx, fileId);
        if (!Page) { ctx.responseStatus = 403; throw new Output({ error: "not allowed" }); }

        await app.fire("page::file_upload-before", { Page });
        const File = await app.dbFiles.file(fileId);
        upload.name = await File.get("name"); // dont change file-name
        await File.replaceFromUpload(upload);
        await app.fire("page::file_upload-after", { Page });

        throw new Output({ id: String(File), url: await File.url() + "/" + await File.get("name") });
    });
}
