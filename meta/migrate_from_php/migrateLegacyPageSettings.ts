import { $item, sql, type App } from "../../module/core/mod.ts";

async function findSettingNodeId(app: App, path: string[]): Promise<number | null> {
    let basis = 0;
    for (const offset of path) {
        const id = await app.db.one`SELECT id FROM qg_setting WHERE basis = ${basis} AND ${sql.id("offset")} = ${offset}`;
        if (!id) return null;
        basis = Number(id);
    }
    return basis;
}

export async function migrateLegacyPageSettings(app: App): Promise<void> {
    const pagesNodeId = await findSettingNodeId(app, ["cms", "pages"]);
    if (!pagesNodeId) return;

    const legacyRows = await app.db.query`SELECT id, ${sql.id("offset")} FROM qg_setting WHERE basis = ${pagesNodeId} ORDER BY id`;
    if (!legacyRows.length) return;

    const legacyPagesRoot = app.settings.cms.pages[$item];
    let migrated = 0;

    for (const row of legacyRows) {
        const pageId = Number(row.offset);
        if (!pageId) continue;

        const currentSettings = await app.db.one`SELECT settings FROM page WHERE id = ${pageId}`;
        if (currentSettings === undefined) continue;
        if (currentSettings) continue;

        const old = await app.settings.cms.pages[String(pageId)];
        if (!old || typeof old !== "object") continue;

        const json = JSON.stringify(old);
        await app.db.query`UPDATE page SET settings = ${json} WHERE id = ${pageId}`;
        await legacyPagesRoot.item(String(pageId)).remove();
        migrated++;
    }

    if (migrated) {
        console.log(`[cms] migrated ${migrated} legacy page settings into page.settings`);
    }
}
