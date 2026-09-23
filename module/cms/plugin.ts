import { fs, header, isTrustedOrigin, Output } from "@qino/qino";

import { CMS, cms, cmsInstances } from "./lib/CMS.ts";
import { initNodeChanged } from "./lib/nodeChanged.ts";
import { cmsCtx } from "./lib/CmsContext.ts";
import { render } from "./lib/render.ts";

import type { App, DbFile } from "@qino/qino";
import type { Node } from "./lib/Node.ts";

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
        backend: {
            type: "integer",
            description: "Page ID of the central backend entry point.",
        },
        frontend: {
            type: "string",
            description: "Name of the active frontend module, e.g. cms.frontend.4.",
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

    // Public pages for the seo module; non-public or offline subtrees are skipped.
    // lastmod: latest change of the page or its contents. image: the page file "main".
    app.on("seo:sitemap", async ({ ctx, base, urls }) => {
        const changed = new Map<number, number>();
        for (const row of await app.db.query`SELECT nc.page_id, MAX(l.time) AS time FROM node_changed nc JOIN log l ON l.id = nc.log_id GROUP BY nc.page_id`)
            changed.set(Number(row.page_id), Number(row.time));
        const walk = async (node: Node) => {
            for (const page of (await node.children({ type: "p" })).values()) {
                if (!await page.isPublic() || !await page.isOnline()) continue;
                if (page.vs.searchable) {
                    const url: Record<string, string> = {};
                    for (const lang of app.languages.all) url[lang] = base + await page.urlSeo(lang);
                    const main = await page.hasFile("main");
                    const image = main?.mime.startsWith("image/") ? ctx.req.url.origin + await main.url() : undefined;
                    urls.push({ url, lastmod: changed.get(page.id), image });
                }
                await walk(page);
            }
        };
        await walk(await cms(app).node(1));
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
    const proc = new Deno.Command("zip", { args: ["-q", "-", "--", ...names], cwd: dir, stdout: "piped", stderr: "null" }).spawn();
    proc.status.finally(cleanup);
    return proc.stdout.pipeThrough(new TransformStream({
        cancel() { // client aborted: stop zip, cleanup runs via proc.status
            try { proc.kill(); } catch { /* already exited */ }
        },
    }));
}
