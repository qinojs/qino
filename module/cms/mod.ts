/**
 * cms/mod.ts - CMS module hooks
 * Port of cms/qg.php
 */

// deno-lint-ignore-file no-explicit-any

import dbSchema from "./dbschema.json" with { type: "json" };
import { CMS } from "./lib/CMS.ts";
import { migrateLegacyPageSettings } from "./lib/migrateLegacyPageSettings.ts";
import { render } from "./lib/render.ts";
import { answer } from "../core/lib/serverInterface.ts";
import { api } from "./apt.ts";
import type { App } from "../core/server.ts";

declare module "../core/server.ts" {
  interface App { cms: CMS; }
}

export const name = "cms";
export const needs = ["core"];
export { dbSchema };

export const settingsSchema = {
    properties: {
        backend: {
            type: "integer",
            description: "Seiten-ID des zentralen Backend-Einstiegs.",
        },
        frontend: {
            type: "string",
            description: "Name des aktiven Frontend-Moduls, z.B. cms.frontend.1.",
        },
        models: {
            type: "string",
            description: "Voreingestellte Modulliste fur neue Inhalte.",
        },
        pageNotFound: {
            type: "integer",
            description: "Seiten-ID fur 404-Fehler.",
        },
        pageNoAccess: {
            type: "integer",
            description: "Seiten-ID fur fehlende Zugriffsrechte.",
        },
        pageOffline: {
            type: "integer",
            description: "Seiten-ID fur Offline-/Wartungsmodus.",
        },
        pageTrash: {
            type: "integer",
            description: "Seiten-ID des Papierkorbs.",
        },
        feedback: {
            properties: {
                email: {
                    type: "string",
                    description: "Empfangeradresse fur CMS-Feedback.",
                },
            },
        },
        pages: {
            description: "Modulspezifische Einstellungen einzelner Seiten.",
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
            description: "Temporare Modulliste fur die aktuelle Session.",
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

    app.on("init", async () => {
        await migrateLegacyPageSettings(app);
    });

    app.on("render", async ({ ctx }) => {
        await render(ctx);
    });

    app.on("action", async ({ctx}) => {
        const settings = ctx.settings;

        // Edit mode
        const editmode = ctx.get.qgCms_editmode;
        if (editmode !== undefined) settings.cms.editmode = editmode;

        // Pre-set editmode for all requests (including AJAX/serverInterface),
        // mirroring PHP: Page->edit reads G()->SET['cms']['editmode']->v directly.
        ctx.state.editmode = parseInt(await settings.cms.editmode) || 0;

        // if (access > 1) { // check access first?
        //     ctx.state.editmode = parseInt(await settings.cms.editmode) || 0;
        // }


        // File upload
        const cmsPageFile = ctx.files["cmsPageFile"];
        if (cmsPageFile) {
            if (cmsPageFile.error) {
                const errors: Record<number, string> = {
                    1: "Die hochgeladene Datei überschreitet die in der Anweisung upload_max_filesize in php.ini festgelegte Größe.",
                    3: "Die Datei wurde nur teilweise hochgeladen.",
                    4: "Es wurde keine Datei hochgeladen.",
                    6: "Fehlender temporärer Ordner.",
                    7: "Speichern der Datei auf die Festplatte ist fehlgeschlagen.",
                    8: "Eine PHP Erweiterung hat den Upload der Datei gestoppt.",
                };
                answer({ error: errors[cmsPageFile.error] ?? "Upload error" });
            }

            // Fix EXIF orientation for JPEG
            // (Deno doesn't have built-in exif support, stub for now)

            const cmspid = parseInt(String(ctx.get["cmspid"] ?? "0"));
            const P = await app.cms.node(cmspid);
            await P.init();
            if ((await P.access()) > 1) {
                const replace = ctx.get["replace"];
                let File: any;
                if (replace) {
                    File = await P.file(replace);
                } else {
                    File = await P.addFile();
                }
                await File.replaceFromUpload(cmsPageFile);
                answer({ id: String(File), url: await File.url() + "/" + await File.get("name") });
            }
        }


        // Page files as ZIP
        const zipPid = ctx.get["qgCms_page_files_as_zip"];
        if (zipPid) {
            const P = await app.cms.node(parseInt(zipPid));
            await P.init();
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
            await P.init();
            if (await P.isReadable()) {
                e.access = 1;
                return;
            }
        }
    });

}

/**
 * cms install()
 * Port of cms/install.php
 */
export async function install({ app }: { app: App }): Promise<void> {
  if (!await app.db.one("SELECT id FROM page WHERE id = 1")) {
    await app.db.query("INSERT INTO page SET id=1, access=1, visible=1, searchable=1, module = 'cms.layout.custom.9', basis = 0, type='p'");
    await (await app.cms.node(1)).title("en", "root");
    await (await app.cms.node(1)).title("de", "root");
  }

  // Import locale files
  const localeDir = new URL("./locale/", import.meta.url).pathname;
  for await (const entry of Deno.readDir(localeDir)) {
    const match = entry.name.match(/^([a-z]{2})\.json$/);
    if (!match) continue;
    const lang = match[1];
    const json = await Deno.readTextFile(localeDir + entry.name);
    await app.languages.import(lang, "cms", json);
  }
}
