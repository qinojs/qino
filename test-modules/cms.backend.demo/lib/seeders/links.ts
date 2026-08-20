// Short links pointing at the demo pages, with a plausible hit history.
import type { Seed } from "../seed.ts";

export async function run(s: Seed): Promise<void> {
  if (!s.module("shorturl") || !await s.app.settings.core.url) return; // a short link needs the public address
  const { shorten } = await import("@qino/qino/shorturl");
  const base = await s.url();
  const table = s.db.table("shorturl");

  for (const page of s.rnd.some(s.pages, s.many(12))) {
    const link = await shorten(s.app, `${base}/${await page.urlSeo(s.app.languages.def)}`);
    const code = link.split("/").pop()!;
    await table.update(code, { hits: s.rnd.int(0, 400), last: s.rnd.past(60, s.now) });
    s.count("short links");
  }
}
