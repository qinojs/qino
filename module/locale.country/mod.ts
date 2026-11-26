// Countries. Names come from Intl in any language; only data Intl lacks is stored.
import type { Db } from "@qino/qino";

const NAMES = new Map<string, Intl.DisplayNames>();
const names = (lang: string) => {
  if (NAMES.size > 50) NAMES.clear(); // lang comes from requests: bounded
  return NAMES.getOrInsertComputed(lang, () => new Intl.DisplayNames([lang], { type: "region" }));
};

export const country = {
  /** "Switzerland", "Schweiz" — the code itself if the language has no name for it. */
  name: (id: string, lang: string): string => (id.length === 2 && names(lang).of(id)) || id,

  get: (db: Db, id: string): Promise<Record<string, unknown> | undefined> => db.row`SELECT * FROM country WHERE id = ${id}`,

  all: (db: Db): Promise<Record<string, unknown>[]> => db.query`SELECT * FROM country ORDER BY id`,

  /** The codes, sorted the way the language sorts the names — for a country picker. */
  async sorted(db: Db, lang: string): Promise<string[]> {
    const collator = new Intl.Collator(lang);
    const ids = await db.col<string>`SELECT id FROM country`;
    return ids.sort((a, b) => collator.compare(country.name(a, lang), country.name(b, lang)));
  },
};
