import { assert, assertEquals } from "@qino/qino/tests";

import { Db } from "@qino/qino";

import { bucketHits, hitBuckets, penaltyState, settings } from "../store.ts";
import { settingsSchema } from "../schema.ts";
import { createSettingItem } from "../../core/lib/SettingItem.ts";
import { enableItemSchemaDefaults } from "../../core/lib/util.ts";

Deno.test("security buckets apply scope weights", () => {
  const info = { ip: "1.2.3.4", ip_range: "1.2.3.0/24", path: "/x", client_id: 9, usr_id: 7 };
  const set = { ipScorePercent: 100, rangeScorePercent: 50, pathScorePercent: 25, clientScorePercent: 0, userBucketPercent: 10 };
  const hits = bucketHits(info, [{ score: 40, reason: "test" }], set);
  assertEquals(hits.find(h => h.scope === "ip")?.score, 40);
  assertEquals(hits.find(h => h.scope === "range")?.score, 20);
  assertEquals(hits.find(h => h.scope === "path")?.score, 10);
  assertEquals(hits.find(h => h.scope === "user")?.score, 4);
});

Deno.test("security path buckets throttle softly and never block", async () => {
  const db = { row: () => Promise.resolve({ scope: "path", ident: "/newsletter", score: 1000, reason: "hot link" }) };
  const set = { delayStartScore: 20, delayFactorMs: 60, maxDelayMs: 6000, blockScore: 120, warnScore: 40, pathDelayStartScore: 200, pathDelayFactorMs: 10, pathMaxDelayMs: 1200 };
  const penalty = await penaltyState(db as never, { path: "/newsletter" }, set);
  assertEquals(penalty.blocked, false);
  assertEquals(penalty.delay, 1200);
});

Deno.test("security bucket writes are serialized per database", async () => {
  const first = Promise.withResolvers<void>();
  const second = Promise.withResolvers<void>();
  const releaseFirst = Promise.withResolvers<void>();
  const releaseSecond = Promise.withResolvers<void>();
  const db = (entered: PromiseWithResolvers<void>, release: PromiseWithResolvers<void>) => ({
    row: async () => { entered.resolve(); await release.promise; return null; },
    table: () => ({ insert: () => Promise.resolve(1), update: () => Promise.resolve() }),
  });
  const info = { ip: "1.2.3.4", path: "/", ip_range: "", client_id: 0, usr_id: 0 };
  const signals = [{ score: 1, reason: "test" }];
  const set = { ipScorePercent: 100, rangeScorePercent: 0, pathScorePercent: 0, clientScorePercent: 0, userBucketPercent: 0, decayPerMin: 0, blockScore: 10, bucketCacheSeconds: 1 };
  const runFirst = hitBuckets({ app: { db: db(first, releaseFirst) } } as never, info, signals, set);
  await first.promise;
  const runSecond = hitBuckets({ app: { db: db(second, releaseSecond) } } as never, info, signals, set);
  const independent = await new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => resolve(false), 100);
    second.promise.then(() => { clearTimeout(timeout); resolve(true); });
  });
  releaseFirst.resolve();
  releaseSecond.resolve();
  await Promise.all([runFirst, runSecond]);
  assert(independent, "another tenant must not wait for the same bucket key");
});

Deno.test("security settings read the stored values, not just the schema defaults", async () => {
  await using db = await settingDb();
  await settingsRoot(db).sub(["cms.backend.system.security"]).set({ enabled: "1", blockScore: "40" });

  // a fresh root, so in-memory items from the write cannot stand in for a real read
  const set = await settings({ settings: settingsRoot(db).proxy } as never);
  assertEquals(set.enabled, true);   // stored, schema-coerced
  assertEquals(set.blockScore, 40);
  assertEquals(set.warnScore, 80);   // untouched key falls back to its default
});

function settingsRoot(db: Db) {
  const root = createSettingItem(db);
  root.setSchema({ properties: { "cms.backend.system.security": settingsSchema } });
  enableItemSchemaDefaults(root);
  return root;
}

/** In-memory settings store — the table the SettingItem reads and writes. */
async function settingDb() {
  const db = new Db("sqlite::memory:");
  await db.query`CREATE TABLE qg_setting (
    id INTEGER PRIMARY KEY AUTOINCREMENT, basis INTEGER NOT NULL DEFAULT 0,
    "offset" TEXT NOT NULL DEFAULT '', value TEXT, type INTEGER NOT NULL DEFAULT 0,
    handler TEXT NOT NULL DEFAULT '', options TEXT NOT NULL DEFAULT '', w INTEGER NOT NULL DEFAULT 0)`;
  await db.loadTables();
  return db;
}
