import { assertEquals } from "../../core/tests/deps.ts";
import { bucketHits, penaltyState } from "../store.ts";

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
  const penalty = await penaltyState(db, { path: "/newsletter" }, set);
  assertEquals(penalty.blocked, false);
  assertEquals(penalty.delay, 1200);
});
