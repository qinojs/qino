import { $item, sql } from "@qino/qino";

import type { App } from "@qino/qino";

/** The settings below `basis` as a plain object. A row with children is a branch, otherwise its
 *  value counts — reading the item instead would only yield the (empty) value of the branch row. */
async function settingTree(app: App, basis: number): Promise<Record<string, unknown>> {
    const rows = await app.db.query`SELECT id, ${sql.id("offset")}, value FROM qg_setting WHERE basis = ${basis} ORDER BY id`;
    const out: Record<string, unknown> = {};
    for (const row of rows) {
        const children = await settingTree(app, Number(row.id));
        out[String(row.offset)] = Object.keys(children).length ? children : (row.value ?? "");
    }
    return out;
}

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

        const old = await settingTree(app, Number(row.id));
        if (!Object.keys(old).length) continue; // nothing to carry over — leave the row alone

        const json = JSON.stringify(old);
        await app.db.query`UPDATE page SET settings = ${json} WHERE id = ${pageId}`;
        await legacyPagesRoot.item(String(pageId)).remove();
        migrated++;
    }

    if (migrated) {
        console.log(`[cms] migrated ${migrated} legacy page settings into page.settings`);
    }
}
