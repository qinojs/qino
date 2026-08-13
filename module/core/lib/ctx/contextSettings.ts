import { bildJsonItem } from "../../deps.ts";
import { enableItemSchemaDefaults } from "../util.ts";

import type { Db } from "../db/Db.ts";
import type { Usr } from "../rows.ts";

async function buildRoot(
    load: () => Promise<string | null | undefined>,
    save: (json: string) => Promise<void>,
    schema?: any,
): Promise<any> {
    const root = bildJsonItem(await load(), save, {debounce:0});
    if (schema) {
        root.setSchema(schema);
        enableItemSchemaDefaults(root);
    }
    return root;
}

export function userSettingsItem(user: Usr, schema?: any): Promise<any> {
    return buildRoot(
        async () => user.settings,
        async (json) => { await user.$set({ settings: json }); },
        schema,
    );
}

export function sessSettingsItem(db: Db, sessId: string | number, schema?: any): Promise<any> {
    return buildRoot(
        async () => (await db.row`SELECT settings FROM sess WHERE id = ${sessId}`)?.settings,
        async (json) => { await db.table("sess").update(sessId, { settings: json }); },
        schema,
    );
}

/**
 * Login merge: copy session settings → user settings (only if user has none yet).
 *
 * Todo? "only if user has none yet" or overwrite only undefined ones? does that make sense? or does it cause complications?
 */
export async function mergeSessionSettingsToUser(db: Db, userId: number, sessId: string): Promise<void> {
    const sessSettings = await db.one`SELECT settings FROM sess WHERE id = ${sessId}`;
    if (!sessSettings || await db.one`SELECT settings FROM usr WHERE id = ${userId}`) return;
    await db.table("usr").update(userId, { settings: sessSettings });
}
