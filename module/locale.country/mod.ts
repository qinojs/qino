// The world's countries. What a standard already knows stays out of the table: the name comes
// from Intl in whatever language is asked for, only codes that no library carries are stored.

import type { Db } from "@qino/qino";

export const country = {
  /** "Switzerland", "Schweiz" — the code itself if the language has no name for it. */
  name(id: string, lang: string): string {
    return (id.length === 2 && new Intl.DisplayNames([lang], { type: "region" }).of(id)) || id;
  },

  get: (db: Db, id: string): Promise<Record<string, unknown> | undefined> => db.row`SELECT * FROM country WHERE id = ${id}`,

  all: (db: Db): Promise<Record<string, unknown>[]> => db.query`SELECT * FROM country ORDER BY id`,

  /** The codes, sorted the way the language sorts the names — for a country picker. */
  async sorted(db: Db, lang: string): Promise<string[]> {
    const collator = new Intl.Collator(lang);
    const ids = await db.col<string>`SELECT id FROM country`;
    return ids.sort((a, b) => collator.compare(country.name(a, lang), country.name(b, lang)));
  },
};
