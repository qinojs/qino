import dbSchema from "./dbschema.json" with { type: "json" };
import { CMS } from "./lib/CMS.ts";
import { render } from "./lib/render.ts";
import { api } from "./apt.ts";
import { Output } from "../core/lib/util.ts";
import type { App } from "../core/server.ts";
import type { RequestContext } from "../core/lib/RequestContext.ts";

declare module "../core/server.ts" {
  interface App { cms: CMS; }
}

export const name = "cms";
export { healthChecks } from "./healthChecks.ts";
export const needs = ["core"];
export { dbSchema };

export const settingsSchema = {
    properties: {
        backend: {
            type: "integer",
            description: "Page ID of the central backend entry point.",
        },
        frontend: {
            type: "string",
            description: "Name of the active frontend module, e.g. cms.frontend.1.",
        },
        models: {
            type: "string",
            description: "Default module list for new content.",
        },
        pageNotFound: {
            type: "integer",
            description: "Page ID for 404 errors.",
        },
        pageNoAccess: {
            type: "integer",
            description: "Page ID for missing access rights.",
        },
        pageOffline: {
            type: "integer",
            description: "Page ID for offline/maintenance mode.",
        },
        pageTrash: {
            type: "integer",
            description: "Page ID of the trash.",
        },
        feedback: {
            properties: {
                email: {
                    type: "string",
                    description: "Recipient address for CMS feedback.",
                },
            },
        },
        pages: {
            description: "Module-specific settings for individual pages.",
            additionalProperties: { type: "object" },
        },
    },
};

export const ctxSettingsSchema = {
    properties: {
        editmode: { type: "boolean", default: 0 },
        clipboard: { type: "integer" },
        models: {
            type: "string",
            description: "Temporary module list for the current session.",
        },
        last_backend_page: { type: "string" },
        last_frontend_page: { type: "string" },
        feedback: {
            properties: {
                text: { type: "string" },
            },
        },
    },
};

export function init(app: App) {

    app.cms = new CMS(app);
    app.aptTree.cms = api;

    app.on("render", async (e) => {
        await render(e.ctx as RequestContext);
    });

    app.on("action", async (e) => {
        const ctx = e.ctx as RequestContext;

        const settings = ctx.settings;

        // Edit mode
        const editmode = ctx.get.qgCms_editmode;
        if (editmode !== undefined) settings.cms.editmode(editmode);

        ctx.state.editmode = Number(await settings.cms.editmode) || 0;

        // File upload
        const cmsPageFile = ctx.files["cmsPageFile"];
        if (cmsPageFile) {
            // Fix EXIF orientation for JPEG
            // (Deno doesn't have built-in exif support, stub for now)
            const cmspid = Number(ctx.get["cmspid"] ?? "0");
            const P = await app.cms.node(cmspid);
            if ((await P.access()) > 1) {
                const replace = ctx.get["replace"];
                const File = await (replace ? P.file(replace) : P.addFile());
                await File.replaceFromUpload(cmsPageFile);
                throw new Output({ id: String(File), url: await File.url() + "/" + await File.get("name") });
            }
        }

        // Page files as ZIP
        const zipPid = ctx.get["qgCms_page_files_as_zip"];
        if (zipPid) {
            const P = await app.cms.node(Number(zipPid));
            if (!(await P.isReadable())) { ctx.responseStatus = 403; return; }
            const files = await P.files();
            if (!Object.keys(files).length) { ctx.responseStatus = 404; return; }
            // In production: create ZIP and send
            ctx.responseHeaders.set("Content-Type", "application/zip");
            ctx.responseHeaders.set("Content-Disposition", `attachment; filename=files_${P}.zip`);
        }
    });

    // File access check
    app.on("dbFile::access2", async (e) => {
        if (e.access) return;
        const rows = await app.db.all("SELECT page_id FROM page_file WHERE file_id = ?", [e.File]);
        for (const vs of rows) {
            const P = await app.cms.node(vs.page_id);
            if (await P.isReadable()) {
                e.access = 1;
                return;
            }
        }
    });

}

export async function install({ app }: { app: App }): Promise<void> {
  if (!await app.db.one("SELECT id FROM page WHERE id = 1")) {
    await app.db.query("INSERT INTO page SET id=1, access=1, visible=1, searchable=1, module = 'cms.layout.custom.9', basis = 0, type='p'");
    await (await app.cms.node(1)).title("en", "root");
  }

  // Import locale files
  const localeDir = new URL("./locale/", import.meta.url).pathname;
  for await (const entry of Deno.readDir(localeDir)) {
    const match = entry.name.match(/^([a-z]{2})\.json$/);
    if (!match) continue;
    const lang = match[1];
    const json = await Deno.readTextFile(localeDir + entry.name);
    //await app.languages.import(lang, "cms", json);
  }
}
