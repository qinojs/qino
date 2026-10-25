import type { App } from "@qino/qino";

/** Every URL the PHP site had stays reachable: qino may name a page anew (its titles regenerate the
 *  URLs below them, a suffix PHP needed for a clash can drop), and an old URL then redirects to the
 *  page — by id, so always to its current URL. A redirect only answers where no page does. Before
 *  `app.init()`, while the URLs are still PHP's. */
export async function keepUrls(app: App): Promise<void> {
  const tables = await app.db.listTables().catch(() => [] as string[]);
  if (!tables.includes("page_url") || !tables.includes("page_redirect")) return;
  // only on the PHP database itself: its texts are not split into text_lang yet
  if (!(await app.db.columns("text").catch(() => [])).some((c) => c.Field === "lang")) return;
  const r = await app.db.exec`INSERT INTO page_redirect (request, redirect)
    SELECT u.url, MIN(u.page_id) FROM page_url u
    WHERE u.url <> '' AND LENGTH(u.url) <= 191 AND u.url NOT IN (SELECT request FROM page_redirect)
    GROUP BY u.url`;
  if (r.affectedRows) console.log(`[migrate] ${r.affectedRows} PHP URLs kept as redirects`);
}
