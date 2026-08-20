// Visits: log rows plus the scores they would have produced. Enough history for the log view,
// the charts and any "most read" ranking to show something.
import { createHash } from "node:crypto";

import type { Seed } from "../seed.ts";

const md5 = (s: string) => createHash("md5").update(s).digest("hex");

/** Id of a dictionary row (url, ip, user agent), inserting it the first time that value is seen. */
async function dictId(s: Seed, table: string, field: string, value: string, rest: Record<string, unknown> = {}): Promise<string> {
  const row = await s.db.table(table).rowBy(field, value);
  return row ? String(row) : String(await s.db.table(table).insert({ [field]: value, ...rest }));
}

export async function run(s: Seed): Promise<void> {
  const base = await s.url();
  const urls: string[] = [];
  for (const page of s.pages) urls.push(base + "/" + await page.urlSeo(s.app.languages.def));
  if (!urls.length) return;

  for (let i = 0; i < s.many(400); i++) {
    const url = s.rnd.chance(0.25) ? urls[0] : s.rnd.pick(urls); // the entry page carries the peak
    const referer = s.rnd.referer();
    const urlId = await dictId(s, "log_url", "hash", md5(url), { url });
    await s.db.table("log").insert({
      time: s.rnd.past(90, s.now),
      url_id: urlId,
      referer_id: referer ? await dictId(s, "log_url", "hash", md5(referer), { url: referer }) : await dictId(s, "log_url", "hash", md5(""), { url: "" }),
      ip_id: await dictId(s, "log_ip", "ip", s.rnd.ip()),
      user_agent_id: await dictId(s, "log_user_agent", "user_agent", s.rnd.ua()),
      post: "",
    });
    s.count("visits");
  }

  if (!s.table("score")) return;
  const { hit, scored, scopes } = await import("@qino/qino/score");
  if (!scopes(s.db).get("page")) await scored(s.db, "page", 30 * 86400);
  for (const page of s.pages) {
    for (let i = s.rnd.int(0, 12); i > 0; i--) await hit(s.db, "page", page.id);
    s.count("scores");
  }
}
