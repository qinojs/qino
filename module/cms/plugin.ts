import dbSchema from "./dbschema.json" with { type: "json" };
import { CMS, cmsInstances } from "./lib/CMS.ts";
import { initNodeChanged } from "./lib/nodeChanged.ts";
import { cms } from "./lib/CMS.ts";
import { cmsCtx } from "./lib/CmsContext.ts";
import { render } from "./lib/render.ts";
import { header, Output, type App, type DbFile } from "../core/mod.ts";

export { api } from "./apt.ts";

export const name = "cms";
export const description = "Provides the CMS page tree, content rendering, files, and access model.";
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
            description: "Name of the active frontend module, e.g. cms.frontend.2.",
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

export function init(app: App, { signal }: { signal: AbortSignal }) {

    cmsInstances.set(app, new CMS(app));

    initNodeChanged(app, signal);

    app.on("render", async (e) => {
        await render(e.ctx);
    }, { signal });

    app.on("route", async ({ ctx }) => {
        const settings = ctx.settings;

        // Edit mode
        const editmode = ctx.req.query.cms_editmode;
        if (editmode !== undefined) settings.cms.editmode(editmode);

        cmsCtx(ctx).editmode = Number(settings.cms.editmode()) || 0;

        // File upload
        const cmsPageFile = await ctx.req.files.cmsPageFile;
        if (cmsPageFile) {
            // Fix EXIF orientation for JPEG (Deno doesn't have built-in exif support, stub for now)
            const cmspid = Number(ctx.req.query.cmspid ?? "0");
            const page = await cms(app).node(cmspid);
            if ((await page.access()) > 1) {
                const replace = ctx.req.query.replace;
                const dbFile = await (replace ? page.file(replace) : page.addFile());
                await dbFile.replaceFromUpload(cmsPageFile);
                throw new Output({ id: String(dbFile), url: await dbFile.url() });
            }
        }

        // Page files as ZIP
        const zipPid = ctx.req.query.cms_nodeFilesZip;
        if (zipPid) {
            const page = await cms(app).node(Number(zipPid));
            if (!(await page.isReadable())) { ctx.res.status = 403; return; }
            const files = Object.values(await page.files());
            if (!files.length) { ctx.res.status = 404; return; }
            const stream = await dbFiles2Zip(files).catch((e) => {
                console.error(e);
                throw new Output("ZIP not available", { status: 501 });
            });
            throw new Output(stream, { headers: [
                ["Content-Type", "application/zip"],
                header.contentDisposition("attachment", `files_${page}.zip`),
            ] });
        }
    }, { signal });

    // File access check
    app.on("dbFile:access-fallback", async (e) => {
        if (e.access) return;
        const dbFile = e.file;
        for (const vs of await app.db.query`SELECT page_id FROM page_file WHERE file_id = ${dbFile.id}`) {
            const page = await cms(app).node(vs.page_id);
            if (await page.isReadable()) {
                e.access = true;
                return;
            }
        }
    }, { signal });

}

export async function install({ app }: { app: App }): Promise<void> {
  if (!await app.db.one`SELECT id FROM page WHERE id = 1`) {
    await app.db.table('page').insert({ id: 1, access: 1, visible: true, searchable: true, module: "cms.layout.custom.9", basis: 0, type: "p" });
    await (await cms(app).node(1)).title("en", "root");
  }
}

/** Streams the given DbFiles as a zip archive using the system `zip` command. */
async function dbFiles2Zip(files: DbFile[]): Promise<ReadableStream<Uint8Array>> {
    const dir = await Deno.makeTempDir({ prefix: "qino-zip-" });
    const names: string[] = [];
    for (const dbFile of files) {
        let name = dbFile.name.replace(/[/\0]/g, "_") || "file";
        if (names.includes(name)) name = names.length + "_" + name;
        await Deno.symlink(dbFile.path, `${dir}/${name}`);
        names.push(name);
    }
    const proc = new Deno.Command("zip", { args: ["-q", "-", "--", ...names], cwd: dir, stdout: "piped", stderr: "null" }).spawn();
    proc.status.finally(() => Deno.remove(dir, { recursive: true }).catch(console.error));
    return proc.stdout;
}
