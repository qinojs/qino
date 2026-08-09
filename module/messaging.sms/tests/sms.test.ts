import { assert, assertEquals, assertRejects, assertThrows } from "../../core/tests/deps.ts";
import { ApiError, Db } from "../../core/mod.ts";
import { dbSchema as messageSchema } from "../../messaging/tests/deps.ts";
import dbSchema from "../dbschema.json" with { type: "json" };
import { deliver } from "../lib/provider.ts";
import { addPhone, approvePhone, pendingPhones, phoneNumber, removePhone, send, setMainPhone, setProvider, userPhones, verifyPhone, type SmsProvider } from "../mod.ts";

async function makeDb(): Promise<Db> {
  const db = new Db("sqlite::memory:");
  await db.migrate({ properties: { ...messageSchema.properties, ...dbSchema.properties } });
  await db.query`CREATE TABLE usr (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL)`;
  await db.query`CREATE TABLE usr_grp (usr_id INTEGER NOT NULL, grp_id INTEGER NOT NULL)`;
  await db.loadTables();
  await db.table("usr").insert({ email: "one@qino.test" });
  await db.table("usr").insert({ email: "two@qino.test" });
  return db;
}

const t = (strings: TemplateStringsArray, ...values: unknown[]) =>
  Promise.all(values).then((v) => strings.reduce((a, s, i) => a + s + (i < v.length ? String(v[i] ?? "") : ""), ""));

const makeApp = (db: Db) => ({
  db,
  t,
  settings: { messaging: { _secret: "test-secret" }, "messaging.sms": { provider: {} } },
  // deno-lint-ignore no-explicit-any
}) as any;

function codeFrom(text: string): string {
  const code = text.match(/\d{6}/)?.[0];
  if (!code) throw new Error("verification code missing");
  return code;
}

Deno.test("phone numbers normalize to E.164", () => {
  assertEquals(phoneNumber(" 0041 (79) 123-45-67 "), "+41791234567");
  assertThrows(() => phoneNumber("079 123 45 67"), ApiError);
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
    await deliver(app, "+41791234567", "Hello");
    assertEquals(calls[0].url, "https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
    assertEquals(new Headers(calls[0].init?.headers).get("authorization"), `Basic ${btoa("SK123:secret")}`);
    assertEquals(String(calls[0].init?.body), "To=%2B41791234567&Body=Hello&From=%2B41000000000");

    app.settings["messaging.sms"].provider = {
      type: "http",
      http: { url: "https://sms.qino.test/send", token: "bearer", from: "Qino" },
    };
    await deliver(app, "+41791234567", "Hello");
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
  assertEquals(first.number, "+41791234567");
  // nothing belongs to the user before the code is redeemed
  assertEquals(await userPhones(app, 1), []);
  assertEquals((await pendingPhones(app, 1)).map((c) => c.address), ["+41791234567"]);
  assertEquals(messages.length, 1);

  await assertRejects(() => verifyPhone(app, 1, "+41791234567", "000000"), ApiError, "Verification code is invalid");
  const verified = await verifyPhone(app, 1, "+41791234567", codeFrom(messages[0].text));
  assert(verified.created);
  assertEquals(Boolean(verified.main), true);
  assertEquals(await pendingPhones(app, 1), []);

  const pending = await addPhone(app, 1, "+41791234568");
  assertEquals((await userPhones(app, 1)).length, 1);
  await assertRejects(() => addPhone(app, 2, "+41791234567"), ApiError, "Phone number is unavailable");
  await assertRejects(() => addPhone(app, 2, String(pending.number)), ApiError, "being verified by someone else");
  await db.table("usr_contact_verification").update({ channel: "sms", address: pending.number }, { expires: 1 });
  assertEquals((await addPhone(app, 2, String(pending.number))).number, "+41791234568");
  assertEquals((await pendingPhones(app, 2)).length, 1);
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
  assertEquals((await userPhones(app, 1)).map((p) => Boolean(p.main)), [true, false]);

  assertEquals(await send(app, { usr: 1 }, "first"), 1);
  await setMainPhone(app, 1, Number(second.id));
  assertEquals(await send(app, { usr: 1 }, "second"), 1);
  assertEquals(delivered, ["+41791234567", "+41791234568"]);

  await removePhone(app, 1, Number(second.id));
  assertEquals(Boolean((await userPhones(app, 1))[0].main), true);
  assertEquals(Number((await userPhones(app, 1))[0].id), Number(first.id));
});

Deno.test("trusted administration can approve a phone without its code", async () => {
  const db = await makeDb();
  const app = makeApp(db);
  setProvider(app, { send: () => Promise.resolve() });
  await addPhone(app, 1, "+41791234567");
  const approved = await approvePhone(app, "+41791234567");
  assert(approved.created);
  assertEquals(Boolean(approved.main), true);
  assertEquals(await pendingPhones(app, 1), []);
});

Deno.test("verification resends are limited and five wrong attempts invalidate the code", async () => {
  const db = await makeDb();
  const app = makeApp(db);
  const messages: string[] = [];
  setProvider(app, { send: (_to, text) => Promise.resolve(void messages.push(text)) });
  await addPhone(app, 1, "+41791234567");

  await assertRejects(() => addPhone(app, 1, "+41791234567"), ApiError, "Wait before requesting");
  for (let i = 0; i < 5; i++) {
    await assertRejects(() => verifyPhone(app, 1, "+41791234567", "000000"), ApiError);
  }
  // the fifth wrong attempt spends the claim, so the real code has nothing left to redeem
  await assertRejects(() => verifyPhone(app, 1, "+41791234567", codeFrom(messages[0])), ApiError, "Nothing to verify");
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
});
