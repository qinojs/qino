import { settingId } from "./plugin.ts";

import type { App } from "@qino/qino";

/* The PHP CMS, and cms.installation.default after it, kept the system pages at fixed ids or in settings,
   without names; qino finds them by name (`cms.nodeByPath(["system", "not-found"])`). Named only where
   a page sits where it should. Before app.init(): the installers would add pages of their own otherwise. */
const BY_ID: [id: number, parent: number, name: string][] = [
  [2, 1, "home"], [10, 1, "service"], [20, 10, "search"], [40, 1, "system"], [5, 40, "layout"], [80, 40, "login"],
];
// the settings that pointed at them: cms.<key> → name below root or system
const BY_SETTING: [key: string, below: "root" | "system", name: string][] = [
  ["backend", "root", "backend"], ["pageNotFound", "system", "not-found"], ["pageNoAccess", "system", "no-access"],
  ["pageOffline", "system", "offline"], ["pageTrash", "system", "trash"],
];

export async function namePages(app: App): Promise<void> {
  const db = app.db, tables = await db.listTables();
  if (!tables.includes("page")) return;
  const give = async (id: number, parent: number, name: string) => {
    const named = await db.exec`UPDATE page SET name = ${name}
      WHERE id = ${id} AND basis = ${parent} AND (name IS NULL OR name = ${""})`;
    if (named.affectedRows) console.log(`[migrate] page ${id} → ${name}`);
  };
  for (const [id, parent, name] of BY_ID) await give(id, parent, name);

  if (!tables.includes("qg_setting")) return;
  const system = Number(await db.one`SELECT id FROM page WHERE basis = 1 AND name = 'system' ORDER BY id LIMIT 1`);
  for (const [key, below, name] of BY_SETTING) {
    const setting = await settingId(app, ["cms", key]);
    const id = Number(setting && await db.one`SELECT value FROM qg_setting WHERE id = ${setting}`);
    if (!id) continue;
    const parent = below === "root" ? 1 : system;
    // a page in two roles (offline = no access) keeps its first name; the cms falls back the same way
    if (Number(await db.one`SELECT basis FROM page WHERE id = ${id}`) === parent) await give(id, parent, name);
    else console.warn(`[migrate] cms.${key} is page ${id}, not below ${below}: move it there, named "${name}"`);
  }
}
