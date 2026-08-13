import { assert, assertEquals } from "../../core/tests/deps.ts";
import { bucketHits, hitBuckets, penaltyState } from "../store.ts";

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
