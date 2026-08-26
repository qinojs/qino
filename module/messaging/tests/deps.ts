import { Db } from "@qino/qino";

import dbSchema from "../dbschema.json" with { type: "json" };

import type { App } from "@qino/qino";

export { dbSchema };
export { messagingPlaceholders } from "../plugin.ts";

/** A shortener that hands out c1, c2 … so what was traded stays readable in the assertions. */
export function fakeShortener() {
  const codes = new Map<string, string>();
  return {
    shorten: (_app: App, url: string) =>
      Promise.resolve(`https://qino.test/s/${codes.getOrInsertComputed(url, () => `c${codes.size + 1}`)}`),
  };
}

/** An app with the journal's tables, a public address, and a shortener unless one says otherwise. */
export async function testApp(short = true): Promise<App> {
  const db = new Db("sqlite::memory:");
  await db.migrate(dbSchema);
  await db.loadTables();
  const linked = short ? [{ plugin: { shortener: fakeShortener() } }] : [];
  return {
    db,
    settings: { core: { _secret: "test-secret" } },
    url: () => Promise.resolve("https://qino.test/cms2/"),
    modules: { linked: () => linked },
  } as unknown as App;
}
