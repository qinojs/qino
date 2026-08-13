import { assertEquals } from "@qino/qino/tests";

import { actionSignals, rankSignal, responseSignal } from "../rules.ts";

Deno.test("security rules detect common probes", () => {
  const info = { path: "/wp-content/plugins/x.php", ip: "1.2.3.4" };
  const signals = actionSignals({}, info);
  assertEquals(signals.some(s => s.reason === "wordpress probe"), true);
  assertEquals(signals.some(s => s.reason === "foreign stack probe"), true);
});

Deno.test("security rules score login and slow responses", () => {
  const login = actionSignals({ loginError: "password" }, { path: "/", ip: "1.2.3.4" });
  assertEquals(login[0].kind, "login");
  const slow = responseSignal({ status: 200, duration_ms: 5000, bytes_in: 0, path: "/" }, { requestWarnMs: 1000, requestMaxMs: 10000, largeBody: 1024 * 1024 });
  assertEquals(slow?.reason, "request warn time");
  assertEquals(slow?.kind, "load");
});

Deno.test("security rules mark request max time as error load", () => {
  const signal = responseSignal({ status: 200, duration_ms: 12000, bytes_in: 0, path: "/" }, { requestWarnMs: 1000, requestMaxMs: 5000, largeBody: 1024 * 1024 });
  assertEquals(signal?.reason, "request max time");
  assertEquals(signal?.prio, "error");
  assertEquals(signal?.kind, "load");
});

Deno.test("security rules rank xss and sql injection hard", () => {
  const xss = actionSignals({}, { path: "/", inspect: "q=<script>alert(1)</script>", ip: "1.2.3.4" });
  assertEquals(xss.some(s => s.kind === "attack" && s.reason === "xss attempt" && s.score >= 120), true);
  const sql = actionSignals({}, { path: "/", inspect: "id=1 UNION SELECT password FROM usr", ip: "1.2.3.4" });
  assertEquals(sql.some(s => s.kind === "attack" && s.reason === "sql injection" && s.score >= 120), true);
});

Deno.test("security rules avoid weak sql false positives", () => {
  const signals = actionSignals({}, { path: "/", inspect: "please select one option from the list", ip: "1.2.3.4" });
  assertEquals(signals.some(s => s.reason === "sql injection"), false);
});

Deno.test("security rules soften logged in noise but not attacks", () => {
  const set = { userScorePercent: 50 };
  const info = { usr_id: 7 };
  assertEquals(rankSignal({ prio: "notice", kind: "request", scope: "path", ident: "/", reason: "request warn time", confidence: 50, severity: 35, score: 20 }, info, set).score, 10);
  assertEquals(rankSignal({ prio: "error", kind: "attack", scope: "ip", ident: "1.2.3.4", reason: "sql injection", confidence: 96, severity: 100, score: 130 }, info, set).score, 130);
});
