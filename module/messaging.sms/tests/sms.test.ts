import { addContact, ApiError, contactKey, contacts, Db, removeContact, setMainContact } from "@qino/qino";
import { assert, assertEquals, assertRejects, assertThrows, authAttemptDbSchema, contactDbSchema, fakeT, messagingDbSchema as messageSchema } from "@qino/qino/tests";

import { ChannelError, outbox, pendingContacts } from "@qino/qino/messaging";

import { deliver as transmit } from "../lib/provider.ts";
import { addPhone, approvePhone, messagingChannel, send, setProvider, verifyPhone } from "../mod.ts";

import type { SmsProvider } from "../mod.ts";

async function makeDb(): Promise<Db> {
  const db = new Db("sqlite::memory:");
  await db.migrate({ properties: { ...messageSchema.properties, ...contactDbSchema.properties, ...authAttemptDbSchema.properties } });
  await db.query`CREATE TABLE usr (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, given_name TEXT, family_name TEXT, organization TEXT)`;
  await db.query`CREATE TABLE usr_grp (usr_id INTEGER NOT NULL, grp_id INTEGER NOT NULL)`;
  await db.loadTables();
  await db.table("usr").insert({ username: "one@qino.test" });
  await db.table("usr").insert({ username: "two@qino.test" });
  return db;
}

const makeApp = (db: Db) => ({
  db,
  t: fakeT,
  settings: { core: { _secret: "test-secret" }, "messaging.sms": { provider: {} } },
  url: () => Promise.resolve("https://qino.test/"),
  modules: { linked: () => [] },
  // deno-lint-ignore no-explicit-any
}) as any;

function codeFrom(text: string): string {
  const code = text.match(/\d{6}/)?.[0];
  if (!code) throw new Error("verification code missing");
  return code;
}

Deno.test("phone numbers normalize to E.164", () => {
  assertEquals(contactKey("phone", " 0041 (79) 123-45-67 "), "+41791234567");
  assertThrows(() => contactKey("phone", "079 123 45 67"), ApiError);
});

Deno.test("built-in Twilio and HTTP providers send their documented request shapes", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return Promise.resolve(new Response("{}", { status: 201 }));
  };
  const app = {
    settings: {
      "messaging.sms": {
        provider: {
          type: "twilio",
          twilio: {
            accountSid: "AC123",
            apiKeySid: "SK123",
            apiKeySecret: "secret",
            from: "+41000000000",
          },
        },
      },
    },
    // deno-lint-ignore no-explicit-any
  } as any;

  try {
    await transmit(app, "+41791234567", "Hello");
    assertEquals(calls[0].url, "https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
    assertEquals(new Headers(calls[0].init?.headers).get("authorization"), `Basic ${btoa("SK123:secret")}`);
    assertEquals(String(calls[0].init?.body), "To=%2B41791234567&Body=Hello&From=%2B41000000000");

    app.settings["messaging.sms"].provider = {
      type: "http",
      http: { url: "https://sms.qino.test/send", token: "bearer", from: "Qino" },
    };
    await transmit(app, "+41791234567", "Hello");
    assertEquals(new Headers(calls[1].init?.headers).get("authorization"), "Bearer bearer");
    assertEquals(JSON.parse(String(calls[1].init?.body)), { to: "+41791234567", text: "Hello", from: "Qino" });
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("a user can verify multiple phones but cannot claim another user's number", async () => {
  const db = await makeDb();
  const app = makeApp(db);
  const messages: { to: string; text: string }[] = [];
  const provider: SmsProvider = { send: (to, text) => Promise.resolve(void messages.push({ to, text })) };
  setProvider(app, provider);

  const first = await addPhone(app, 1, "+41 79 123 45 67");
  assertEquals(first.address, "+41791234567");
  // nothing belongs to the user before the code is redeemed
  assertEquals(await contacts(app.db, 1, "phone"), []);
  assertEquals((await pendingContacts(app, "phone", 1)).map((c) => c.address), ["+41791234567"]);
  assertEquals(messages.length, 1);

  await assertRejects(() => verifyPhone(app, 1, "+41791234567", "000000"), ApiError, "Verification code is invalid");
  const verified = await verifyPhone(app, 1, "+41791234567", codeFrom(messages[0].text));
  assert(verified.created);
  assertEquals(Boolean(verified.main), true);
  assertEquals(await pendingContacts(app, "phone", 1), []);
  assertEquals((await addPhone(app, 1, "+41791234567")).address, "+41791234567");

  const pending = await addPhone(app, 1, "+41791234568");
  assertEquals((await contacts(app.db, 1, "phone")).length, 1);
  await assertRejects(() => addPhone(app, 2, "+41791234567"), ApiError, "Phone number is unavailable");
  // a stranger may claim the same number: refusing would let anyone lock its owner out of verifying
  await assertRejects(() => addPhone(app, 2, String(pending.address)), ApiError, "Wait before requesting");
  await db.table("usr_contact_verification").update({ type: "phone", address: pending.address, usr_id: 1 }, { sent: 1 });
  assertEquals((await addPhone(app, 2, String(pending.address))).address, "+41791234568");
  assertEquals((await pendingContacts(app, "phone", 2)).length, 1);
  assertEquals((await pendingContacts(app, "phone", 1)).length, 1); // both claims stand, each with its own code
});

Deno.test("one verified phone becomes main and users can switch or delete the main number", async () => {
  const db = await makeDb();
  const app = makeApp(db);
  const codes: Record<string, string> = {};
  const delivered: string[] = [];
  setProvider(app, {
    send: (to, text) => {
      text.includes("verification") ? codes[to] = codeFrom(text) : delivered.push(to);
      return Promise.resolve();
    },
  });

  await addPhone(app, 1, "+41791234567");
  const first = await verifyPhone(app, 1, "+41791234567", codes["+41791234567"]);
  await addPhone(app, 1, "+41791234568");
  const second = await verifyPhone(app, 1, "+41791234568", codes["+41791234568"]);
  assertEquals((await contacts(app.db, 1, "phone")).map((p) => Boolean(p.main)), [true, false]);

  assertEquals(await send(app, { usr: 1 }, "first"), 1);
  await setMainContact(app.db, 1, "phone", String(second.address));
  assertEquals(await send(app, { usr: 1 }, "second"), 1);
  assertEquals(delivered, ["+41791234567", "+41791234568"]);

  await removeContact(app.db, 1, "phone", String(second.address));
  assertEquals(Boolean((await contacts(app.db, 1, "phone"))[0].main), true);
  assertEquals((await contacts(app.db, 1, "phone"))[0].address, first.address);
});

Deno.test("trusted administration can approve a phone without its code", async () => {
  const db = await makeDb();
  const app = makeApp(db);
  setProvider(app, { send: () => Promise.resolve() });
  await addPhone(app, 1, "+41791234567");
  const approved = await approvePhone(app, 1, "+41791234567");
  assert(approved.created);
  assertEquals(Boolean(approved.main), true);
  assertEquals(await pendingContacts(app, "phone", 1), []);
});

Deno.test("verification resends are limited and wrong attempts buy a growing wait", async () => {
  const db = await makeDb();
  const app = makeApp(db);
  const messages: string[] = [];
  setProvider(app, { send: (_to, text) => Promise.resolve(void messages.push(text)) });
  await addPhone(app, 1, "+41791234567");

  await assertRejects(() => addPhone(app, 1, "+41791234567"), ApiError, "Wait before requesting");
  for (let i = 0; i < 5; i++) {
    await assertRejects(() => verifyPhone(app, 1, "+41791234567", "000000"), ApiError);
  }
  // the code is still good, but the account has to sit out what the wrong ones earned
  await assertRejects(() => verifyPhone(app, 1, "+41791234567", codeFrom(messages[0])), ApiError, "Too many attempts");
});

Deno.test("send reaches only verified phones selected by user, group or all", async () => {
  const db = await makeDb();
  const app = makeApp(db);
  const delivered: string[] = [];
  const codes: Record<string, string> = {};
  setProvider(app, {
    send: (to, text) => {
      text.includes("verification") ? codes[to] = codeFrom(text) : delivered.push(to);
      return Promise.resolve();
    },
  });

  await addPhone(app, 1, "+41791234567");
  await verifyPhone(app, 1, "+41791234567", codes["+41791234567"]);
  await addPhone(app, 2, "+41791234568");
  await verifyPhone(app, 2, "+41791234568", codes["+41791234568"]);
  await addPhone(app, 2, "+41791234569"); // remains pending
  await db.table("usr_grp").insert({ usr_id: 2, grp_id: 7 });

  assertEquals(await send(app, { usr: 1 }, "user"), 1);
  assertEquals(await send(app, { grp: 7 }, "group"), 1);
  assertEquals(await send(app, { all: true }, "all"), 2);
  assertEquals(delivered, ["+41791234567", "+41791234568", "+41791234567", "+41791234568"]);

  // selectors add up; direct verified numbers carry their owner, unknown ones go out anonymous
  assertEquals(await send(app, { grp: 7, phone: [" 0041 (79) 123-45-67 ", "079 12", "+41799999999", "+41791234567"] }, "direct"), 3);
  const owners = await db.query`SELECT d.usr_id, d.address, d.error FROM message m
    JOIN message_delivery d ON d.message_id = m.id WHERE m.text = ${"direct"} ORDER BY d.address`;
  assertEquals(owners.map((r) => [r.address, r.usr_id, r.error]), [
    ["+41791234567", 1, null], ["+41791234568", 2, null], ["+41799999999", null, null],
    ["079 12", null, "Use an international phone number such as +41791234567"],
  ]);
});

Deno.test("a failure of ours never marks the number", async () => {
  const db = await makeDb();
  const app = makeApp(db);
  await addContact(db, 1, "phone", "+41791234567");

  // no provider configured: the installation is at fault, the number is fine
  assertEquals(await send(app, { usr: 1 }, "Hi"), 0);
  assertEquals((await contacts(db, 1, "phone"))[0].error, null);
  const [delivery] = await db.query`SELECT error FROM message_delivery`;
  assert(String(delivery.error).includes("configure provider.type"), "the journal keeps the reason");

  // the provider refusing the number is about the number, and says so on the contact
  setProvider(app, { send: () => Promise.reject(new Error("unreachable handset")) });
  assertEquals(await send(app, { usr: 1 }, "Hi"), 0);
  assertEquals((await contacts(db, 1, "phone"))[0].error, "unreachable handset");

  // and a delivery that works again clears it
  setProvider(app, { send: () => Promise.resolve() });
  assertEquals(await send(app, { usr: 1 }, "Hi"), 1);
  assertEquals((await contacts(db, 1, "phone"))[0].error, null);
});

Deno.test("only a plain refusal from an http provider blames the number", async () => {
  const status = (code: number) => new Response("no", { status: code });
  const original = globalThis.fetch;
  const app = {
    t: fakeT,
    settings: { "messaging.sms": { provider: { type: "http", http: { url: "https://sms.qino.test/send" } } } },
    // deno-lint-ignore no-explicit-any
  } as any;
  try {
    for (const code of [500, 401, 429]) {
      globalThis.fetch = () => Promise.resolve(status(code));
      const e = await transmit(app, "+41791234567", "Hi").catch((e) => e);
      assert(e instanceof ChannelError, `${code} is ours`);
    }
    globalThis.fetch = () => Promise.resolve(status(400));
    const e = await transmit(app, "+41791234567", "Hi").catch((e) => e);
    assert(e instanceof Error && !(e instanceof ChannelError), "400 is about the number");
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("what our own failure held back goes out on the next run", async () => {
  const db = await makeDb();
  const app = makeApp(db);
  const sms: SmsProvider = { send: () => Promise.resolve() };
  app.modules = { linked: () => [{ plugin: { messagingChannel } }] };
  await addContact(db, 1, "phone", "+41791234567");

  // no provider: nothing goes out, and the delivery stays owed
  assertEquals(await send(app, { usr: 1 }, "Hi"), 0);
  const [held] = await db.query`SELECT * FROM message_delivery`;
  assertEquals(held.sent, null);
  assertEquals(held.attempts, 1);
  assert(Number(held.due) > 0, "owed again");

  // due, and this time there is a provider
  await db.exec`UPDATE message_delivery SET due = ${1}`;
  setProvider(app, sms);
  assertEquals(await outbox(app), 1);

  const [done] = await db.query`SELECT * FROM message_delivery`;
  assertEquals(done.due, null);
  assertEquals(done.error, null);
  assert(Number(done.sent) > 0, "went out");
});
