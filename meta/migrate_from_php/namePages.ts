import type { App } from "@qino/qino";

/* The PHP CMS, and cms.installation.default after it, put the system pages at fixed ids, without names;
   qino finds them by name (`root.child("system").child("layout")`). Named only where a page sits where
   it should. Before app.init(): the installers would add pages of their own otherwise. */
const PAGES: [id: number, parent: number, name: string][] = [
  [2, 1, "home"], [10, 1, "service"], [20, 10, "search"],
  [40, 1, "system"], [5, 40, "layout"], [50, 40, "trash"], [60, 40, "no-access"], [70, 40, "not-found"],
  [80, 40, "login"],
];

export async function namePages(app: App): Promise<void> {
  if (!(await app.db.listTables()).includes("page")) return;
  for (const [id, parent, name] of PAGES) {
    const named = await app.db.exec`UPDATE page SET name = ${name}
      WHERE id = ${id} AND basis = ${parent} AND (name IS NULL OR name = ${""})`;
    if (named.affectedRows) console.log(`[migrate] page ${id} → ${name}`);
  }
}
