import { Db } from "@qino/qino";
import { assert, assertEquals, messagingDbSchema } from "@qino/qino/tests";
import { record } from "@qino/qino/messaging";

import { spamOf } from "../lib/spam.ts";

import type { App } from "@qino/qino";

// No ai in these apps: only the receiving server's verdict counts.

async function withApp(fn: (app: App) => Promise<void>) {
  const db = new Db("sqlite::memory:");
  await db.migrate(messagingDbSchema);
  await db.loadTables();
  const app = { db, modules: { linked: () => undefined } } as unknown as App;
  try {
    await fn(app);
  } finally {
    await db.close();
  }
}

const to = "app@qino.test";
const mail = (...lines: string[]) => ({
  subject: "Hello",
  text: "Hi there",
  headerLines: lines.map((line) => ({ key: line.slice(0, line.indexOf(":")).toLowerCase(), line })),
});

Deno.test("spamOf: nothing said is clean", () => withApp(async (app) => {
  assertEquals(await spamOf(app, mail("Authentication-Results: mx.qino.test; dmarc=pass"), { from: "a@b.test", to }), 0);
}));

Deno.test("spamOf: only the receiving server's own check counts", () => withApp(async (app) => {
  const forged = mail("Authentication-Results: mx.qino.test; dmarc=fail", "Authentication-Results: x; spf=pass");
  assert(await spamOf(app, forged, { from: "a@b.test", to }) >= 0.9);
  const forwarded = mail("Authentication-Results: mx.qino.test; dmarc=pass", "Authentication-Results: x; dmarc=fail");
  assertEquals(await spamOf(app, forwarded, { from: "a@b.test", to }), 0);
  assert(await spamOf(app, mail("Authentication-Results: mx.qino.test; spf=fail"), { from: "a@b.test", to }) < 0.5);
}));

Deno.test("spamOf: the server's filter flags spam", () => withApp(async (app) => {
  assert(await spamOf(app, mail("X-Spam-Status: Yes, score=7.1"), { from: "a@b.test", to }) >= 0.9);
  assert(await spamOf(app, mail("X-Spam-Flag: YES"), { from: "a@b.test", to }) >= 0.9);
  assertEquals(await spamOf(app, mail("X-Spam-Status: No, score=0.3"), { from: "a@b.test", to }), 0);
}));

Deno.test("spamOf: a known sender is judged like anyone — an account can be taken over", () => withApp(async (app) => {
  const flagged = mail("X-Spam-Flag: YES");
  const failed = mail("Authentication-Results: mx.qino.test; dmarc=fail");
  assert(await spamOf(app, flagged, { from: "a@b.test", usrId: 1, to }) >= 0.9);
  assert(await spamOf(app, failed, { from: "a@b.test", usrId: 1, to }) >= 0.9);

  await record(app, { channel: "email", direction: "out", msg: "Offer" }, [{ address: "c@d.test", sent: 1 }]);
  assert(await spamOf(app, flagged, { from: "c@d.test", to }) >= 0.9, "mailed before");
}));
