import { spawn } from "node:child_process";
import { once } from "node:events";
import { Readable } from "node:stream";
import { fs, header, isTrustedOrigin, Output } from "@qino/qino";

import { CMS, cms, cmsInstances } from "./lib/CMS.ts";
import { initNodeChanged } from "./lib/nodeChanged.ts";
import { cmsCtx } from "./lib/CmsContext.ts";
import { render } from "./lib/render.ts";

import type { App, DbFile } from "@qino/qino";

export { api } from "./api.ts";

export { healthChecks } from "./healthChecks.ts";
export { default as dbSchema } from "./dbschema.json" with { type: "json" };

export const settingsSchema = {
    properties: {
        sanitize: {
            properties: {
                elements: { type: "string", description: "Elements rich text may carry, e.g. \"p h2 a img\". Empty = what qino ships with." },
                attributes: { type: "string", description: "Attributes, in the editor's grammar: \"class title, a(href target)\"." },
                protocols: { type: "string", description: "Url protocols: \"href: http https, img(src: http https data)\"." },
            },
        },
        frontend: {
            type: "string",
            description: "Name of the active frontend module, e.g. cms.frontend.",
        },
        models: {
            type: "string",
            description: "Default module list for new content.",
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

export async function init(app: App, { signal }: { signal: AbortSignal }) {

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
            if (isTrustedOrigin(ctx.req) && await page.access() > 1) {
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
            const files = [...(await page.files()).values()];
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

    // url → page id is cached, so any write to page_url drops it
    for (const name of ["table:insert-after", "table:update-after", "table:delete-after"] as const)
        app.db.on(name, (e) => { if (String(e.table) === "page_url") cms(app).clearUrlCache(); }, { signal });

    // Uploading into a placeholder changes the file row, not page_file, so invalidate the nodes.
    app.db.on("table:update-after", async (e) => {
        if (String(e.table) !== "file" || !("md5" in (e.data ?? {}))) return;
        for (const vs of await app.db.query`SELECT page_id FROM page_file WHERE file_id = ${Number(e.id)}`)
            (await cms(app).node(Number(vs.page_id))).clearFileCache();
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


    // the languages are read at the start, so a new one shows here: its addresses
    for (const lang of app.languages.all) {
        if (await app.db.one`SELECT 1 FROM page_url WHERE lang = ${lang} LIMIT 1`) continue;
        if (await app.db.one`SELECT 1 FROM page WHERE id = 1`) await (await cms(app).node(1)).urlsGen(lang); // none yet: nothing to do, and no node to cache
    }
}

export async function install({ app }: { app: App }): Promise<void> {
  await app.db.exec`DELETE FROM page_url WHERE url LIKE ${"#cmspid%"}`; // computed now, and copies carried wrong ones
  if (!await app.db.one`SELECT id FROM page WHERE id = 1`) {
    await app.db.table('page').insert({ id: 1, access: 1, visible: true, searchable: true, module: "cms.layout.standard.2", basis: 0, type: "p" });
    await (await cms(app).node(1)).title("en", "root");
  }
}

/** Streams the given DbFiles as a zip archive using the system `zip` command. */
async function dbFiles2Zip(files: DbFile[]): Promise<ReadableStream<Uint8Array>> {
    const dir = await fs.tempDir({ prefix: "qino-zip-" });
    const cleanup = () => fs.remove(dir, { recursive: true }).catch(console.error);
    const names: string[] = [];
    try {
        for (const dbFile of files) {
            let name = dbFile.name.replace(/[/\0]/g, "_") || "file";
            if (names.includes(name)) name = names.length + "_" + name;
            await fs.symlink(dbFile.path, `${dir}/${name}`);
            names.push(name);
        }
    } catch (e) {
        await cleanup();
        throw e;
    }
    const proc = spawn("zip", ["-q", "-", "--", ...names], { cwd: dir, stdio: ["ignore", "pipe", "ignore"] });
    proc.on("close", cleanup); // also after a failed start, or an aborted download: zip dies of the closed pipe
    await once(proc, "spawn"); // a missing zip rejects here
    return Readable.toWeb(proc.stdout) as ReadableStream<Uint8Array>;
}
