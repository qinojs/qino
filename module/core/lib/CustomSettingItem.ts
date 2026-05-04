// deno-lint-ignore-file no-explicit-any

import { DB } from "./db.ts";
import { bildJsonItem } from "../../../deps.ts";

async function buildRoot(
    load: () => Promise<string | null | undefined>,
    save: (json: string) => Promise<void>,
    schema?: any,
): Promise<any> {
    const root = bildJsonItem(await load(), save);
    if (schema) root.setSchema(schema);
    return root;
}

export function userSettingsItem(user: any, schema?: any): Promise<any> {
    return buildRoot(
        () => user.get("settings"),
        (json) => user.set("settings", json),
        schema,
    );
}

export function sessSettingsItem(db: DB, sessId: string | number, schema?: any): Promise<any> {
    return buildRoot(
        async () => (await db.row("SELECT settings FROM sess WHERE id = ?", [sessId]))?.settings,
        async (json) => { await db.query("UPDATE sess SET settings = ? WHERE id = ?", [json, sessId]); },
        schema,
    );
}


/**
 * Login-Merge: Session-Settings → User-Settings übernehmen (nur wenn User noch keine hat).
 *
 * Todo? "nur wenn User noch keine hat" oder nur die überschreiben welche undefined sind? macht das sinn? oder gibt das komplikationen?
 */
export async function mergeSessionSettingsToUser(db: DB, userId: number, sessId: string): Promise<void> {
    const sessSettings = await db.one("SELECT settings FROM sess WHERE id = ?", [sessId]);
    if (!sessSettings) return;
    const usrSettings = await db.one("SELECT settings FROM usr WHERE id = ?", [userId]);
    if (usrSettings) return;
    await db.query("UPDATE usr SET settings = ? WHERE id = ?", [sessSettings, userId]);
}
