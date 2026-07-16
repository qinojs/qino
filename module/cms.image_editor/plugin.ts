// deno-lint-ignore-file no-explicit-any

import { Access, Output, type App, type AptTree, type Ctx, s } from "../core/mod.ts";
import { cmsCtx } from "../cms/mod.ts";
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

const canWrite = ({ file }: any, ctx: Ctx) => isWritable(ctx, Number(file));

export const api: AptTree = {
  meta: {
    ":file": {
      get: {
        description: "Read editable image meta (name, hpos, vpos).",
        access: Access.USER,
        guard: canWrite,
        execute: ({ file }: any, ctx: any) => getMeta(ctx, Number(file)),
      },
      put: {
        description: "Update image meta (name, hpos, vpos).",
        access: Access.USER,
        guard: canWrite,
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
        access: Access.USER,
        guard: canWrite,
        execute: ({ file }: any, ctx: any) => getHistory(ctx, Number(file)),
      },
    },
  },
  restore: {
    ":file": {
      post: {
        description: "Restore a previous version of an image.",
        access: Access.USER,
        guard: canWrite,
        input: s.object({ log: s.number() }),
        execute: ({ file, log }: any, ctx: any) => restore(ctx, Number(file), Number(log)),
      },
    },
  },
};

export function init(app: App) {
  app.on("cms:page-ready", ({ ctx }) => {
    if (ctx.req.query.cms_noFrontend) return;
    if (!cmsCtx(ctx).editmode) return;
    ctx.res.html.scripts.add(ctx.req.modulePath + "cms.image_editor/pub/init.mjs");
  });

  // Replace an existing image with the edited version (keeps the filename).
  app.on("route", async ({ ctx }) => {
    const upload = await ctx.req.files.editedImage;
    if (!upload) return;

    const fileId = Number(ctx.req.query.file_id ?? "0");
    const Page = await writablePage(ctx, fileId);
    if (!Page) { ctx.res.status = 403; throw new Output({ error: "not allowed" }); }

    await app.fire("node:fileUpload-before", { node: Page });
    const File = await app.dbFiles.file(fileId);
    upload.name = await File.get("name"); // dont change file-name
    await File.replaceFromUpload(upload);

    throw new Output({ id: String(File), url: await File.url() });
  });
}
