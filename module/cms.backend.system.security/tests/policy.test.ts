import { assertEquals } from "@qino/qino/tests";

import { decide } from "../policy.ts";

Deno.test("security policy blocks high confidence attacks", () => {
  const signal = { prio: "error", kind: "attack", scope: "ip", ident: "1.2.3.4", reason: "xss attempt", confidence: 96, severity: 100, score: 120 };
  assertEquals(decide({ score: 0, delay: 0, blocked: false, warn: false }, [signal], { attackBlockConfidence: 92 }).blocked, true);
  assertEquals(decide({ score: 0, delay: 0, blocked: false, warn: false }, [signal], { attackBlockConfidence: 92 }, true).blocked, false);
});
