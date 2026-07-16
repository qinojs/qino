import dbSchema from "./dbschema.json" with { type: "json" };
import { CMS, cmsInstances } from "./lib/CMS.ts";
import { cms, cmsCtx } from "./mod.ts";
import { READ } from "./lib/access.ts";
import { render } from "./lib/render.ts";
export { api } from "./apt.ts";
import { header, Output, type App, type DbFile } from "../core/mod.ts";

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

export function init(app: App) {

    cmsInstances.set(app, new CMS(app));

    app.on("render", async (e) => {
        await render(e.ctx);
    });

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
            const P = await cms(app).node(cmspid);
            if ((await P.access()) > 1) {
                const replace = ctx.req.query.replace;
                const File = await (replace ? P.file(replace) : P.addFile());
                await File.replaceFromUpload(cmsPageFile);
                throw new Output({ id: String(File), url: await File.url() });
            }
        }

        // Page files as ZIP
        const zipPid = ctx.req.query.cms_nodeFilesZip;
        if (zipPid) {
            const P = await cms(app).node(Number(zipPid));
            if (!(await P.isReadable())) { ctx.res.status = 403; return; }
            const files = Object.values(await P.files());
            if (!files.length) { ctx.res.status = 404; return; }
            const stream = await dbFiles2Zip(files).catch((e) => {
                console.error(e);
                throw new Output("ZIP not available", { status: 501 });
            });
            throw new Output(stream, { headers: [
                ["Content-Type", "application/zip"],
                header.contentDisposition("attachment", `files_${P}.zip`),
            ] });
        }
    });

    // File access check
    app.on("dbFile:access2", async (e) => {
        if (e.access) return;
        const File = e.File;
        const rows = await app.db.query`SELECT page_id FROM page_file WHERE file_id = ${File.id}`;
        for (const vs of rows) {
            const P = await cms(app).node(vs.page_id);
            if (await P.isReadable()) {
                e.access = true;
                return;
            }
        }
    });

}

export async function install({ app }: { app: App }): Promise<void> {
  if (!await app.db.one`SELECT id FROM page WHERE id = 1`) {
    await app.db.table('page').insert({ id: 1, access: 1, visible: 1, searchable: 1, module: "cms.layout.custom.9", basis: 0, type: "p" });
    await (await cms(app).node(1)).title("en", "root");
  }
  // Register renderable modules with their access level; default READ = visible, creatable only by superusers.
  for (const mod of Object.values(app.modules.all())) {
    if (!mod.plugin.cms?.node?.render) continue;
    if (await app.db.one`SELECT name FROM module WHERE name = ${mod.name}`) continue;
    await app.db.table('module').insert({ name: mod.name, cms_access: mod.plugin.cms.access ?? READ });
  }
}

/** Streams the given DbFiles as a zip archive using the system `zip` command. */
async function dbFiles2Zip(files: DbFile[]): Promise<ReadableStream<Uint8Array>> {
    const dir = await Deno.makeTempDir({ prefix: "qino-zip-" });
    const names: string[] = [];
    for (const F of files) {
        let name = F.name.replace(/[/\0]/g, "_") || "file";
        if (names.includes(name)) name = names.length + "_" + name;
        await Deno.symlink(F.path, `${dir}/${name}`);
        names.push(name);
    }
    const proc = new Deno.Command("zip", { args: ["-q", "-", "--", ...names], cwd: dir, stdout: "piped", stderr: "null" }).spawn();
    proc.status.finally(() => Deno.remove(dir, { recursive: true }).catch(console.error));
    return proc.stdout;
}
