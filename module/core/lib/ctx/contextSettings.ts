import { bildJsonItem } from "../../deps.ts";
import { enableItemSchemaDefaults } from "../util.ts";

import type { Db } from "../db/Db.ts";
import type { Session } from "../SessionManager.ts";
import type { Usr } from "../rows.ts";

function buildRoot(
    json: string | null | undefined,
    save: (json: string) => Promise<void>,
    schema?: any,
): any {
    const root = bildJsonItem(json, save, {debounce:0});
    if (schema) {
        root.setSchema(schema);
        enableItemSchemaDefaults(root);
    }
    return root;
}

export function userSettingsItem(user: Usr, schema?: any): any {
    return buildRoot(
        user.settings,
        async (json) => { await user.$set({ settings: json }); },
        schema,
    );
}

/* ugly — why not sess.settingsItem ?? usr.settingsItem directly, as a lazy item generator? */
export function sessSettingsItem(sess: Session, schema?: any): any {
    return buildRoot(
        sess.settings,
        async (json) => {
            sess.settings = json;
            await sess.db.table("sess").update(sess.id, { settings: json });
        },
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
