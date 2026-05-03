// deno-lint-ignore-file no-explicit-any

import { $item } from "item/item.js";
import type { App } from "../../core/server.ts";

async function findSettingNodeId(app: App, path: string[]): Promise<number | null> {
    let basis = 0;
    for (const offset of path) {
        const id = await app.db.one(
            "SELECT id FROM qg_setting WHERE basis = ? AND `offset` = ?",
            [basis, offset],
        );
        if (!id) return null;
        basis = parseInt(String(id));
    }
    return basis;
}

export async function migrateLegacyPageSettings(app: App): Promise<void> {
    const pagesNodeId = await findSettingNodeId(app, ["cms", "pages"]);
    if (!pagesNodeId) return;

    const legacyRows = await app.db.all(
        "SELECT id, `offset` FROM qg_setting WHERE basis = ? ORDER BY id",
        [pagesNodeId],
    );
    if (!legacyRows.length) return;

    const legacyPagesRoot = app.settings.cms.pages[$item];
    let migrated = 0;

    for (const row of legacyRows) {
        const pageId = parseInt(String(row.offset));
        if (!pageId) continue;

        const currentSettings = await app.db.one("SELECT settings FROM page WHERE id = ?", [pageId]);
        if (currentSettings === undefined) continue;
        if (currentSettings) continue;

        const old = await app.settings.cms.pages[String(pageId)];
        if (!old || typeof old !== "object") continue;

        const json = JSON.stringify(old);
        await app.db.query("UPDATE page SET settings = ? WHERE id = ?", [json, pageId]);
        await legacyPagesRoot.item(String(pageId)).remove();
        migrated++;
    }

    if (migrated) {
        console.log(`[cms] migrated ${migrated} legacy page settings into page.settings`);
    }
}
