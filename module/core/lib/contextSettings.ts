// deno-lint-ignore-file no-explicit-any

import type { Db } from "./db/Db.ts";
import { bildJsonItem } from "../../../deps.ts";

async function buildRoot(
    load: () => Promise<string | null | undefined>,
    save: (json: string) => Promise<void>,
    schema?: any,
): Promise<any> {
    const root = bildJsonItem(await load(), save, {debounce:0});
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

export function sessSettingsItem(db: Db, sessId: string | number, schema?: any): Promise<any> {
    return buildRoot(
        async () => (await db.row`SELECT settings FROM sess WHERE id = ${sessId}`)?.settings,
        async (json) => { await db.query`UPDATE sess SET settings = ${json} WHERE id = ${sessId}`; },
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
    if (!sessSettings) return;
    const usrSettings = await db.one`SELECT settings FROM usr WHERE id = ${userId}`;
    if (usrSettings) return;
    await db.query`UPDATE usr SET settings = ${sessSettings} WHERE id = ${userId}`;
}
