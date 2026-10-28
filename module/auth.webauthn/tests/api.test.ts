import { AccessError, Db, invoke, toTools, requestStorage } from "@qino/qino";
import { assertEquals, assertRejects, testContext } from "@qino/qino/tests";

import { api, authFactors, cron, expectedOrigins, init, settingsSchema } from "../plugin.ts";
import dbSchema from "../dbschema.json" with { type: "json" };
import manifest from "../manifest.json" with { type: "json" };

const { name } = manifest;

function makeApp() {
  const challenges: Record<string, unknown>[] = [];
  const execs: Array<[string, unknown[]]> = [];
  const app = {
    settings: { core: {}, "auth.webauthn": { rpId: "localhost" } } as Record<string, Record<string, unknown>>,
    fire: () => Promise.resolve(),
    db: {
      row: () => null,
      all: () => [],
      exec: (sql: string, params: unknown[]) => execs.push([sql, params]),
      table: (name: string) => ({
        row: (id: number) => name === "usr" && id ? { id, superuser: false } : null,
        insert: (row: Record<string, unknown>) => challenges.push(row),
      }),
    },
    apiTree: { "auth.webauthn": api },
  };
  return { app, challenges, execs };
}


Deno.test("auth.webauthn: module metadata is wired", () => {
  assertEquals(name, "auth.webauthn");
  assertEquals(settingsSchema.properties.rpId.type, "string");
});

Deno.test("auth.webauthn: api exposes expected api endpoints", () => {
  const tools = toTools(api);
  assertEquals(tools.map((tool) => tool.name), [
    "register_challenge_post",
    "register_verify_post",
    "login_challenge_post",
    "login_verify_post",
    "confirm_challenge_post",
    "confirm_verify_post",
    "credentials_get",
    "credential_delete",
  ]);

  const registerVerify = tools.find((tool) => tool.name === "register_verify_post");
  assertEquals(registerVerify?.parameters, {
    type: "object",
    properties: {
      token: { type: "string" },
      credentialId: { type: "string" },
      clientDataJSON: { type: "string" },
      attestationObject: { type: "string" },
      name: { type: "string" },
    },
    required: ["token", "credentialId", "clientDataJSON", "attestationObject"],
  });

  const loginVerify = tools.find((tool) => tool.name === "login_verify_post");
  assertEquals(loginVerify?.parameters, {
    type: "object",
    properties: {
      token: { type: "string" },
      credentialId: { type: "string" },
      clientDataJSON: { type: "string" },
      authenticatorData: { type: "string" },
      signature: { type: "string" },
    },
    required: ["token", "credentialId", "clientDataJSON", "authenticatorData", "signature"],
  });
});

Deno.test("auth.webauthn: user-only endpoints reject guests", async () => {
  const { app } = makeApp();
  const c = await testContext({ app });
  await requestStorage.run(c, async () => {
    await assertRejects(() => invoke((app as any).apiTree["auth.webauthn"], "POST", "/register/challenge"), AccessError);
    await assertRejects(() => invoke((app as any).apiTree["auth.webauthn"], "POST", "/confirm/challenge"), AccessError);
    await assertRejects(() => invoke((app as any).apiTree["auth.webauthn"], "GET", "/credentials"), AccessError);
  });
});

Deno.test("auth.webauthn: public login challenge stores challenge state without extra queries", async () => {
  const { app, challenges, execs } = makeApp();
  const c = await testContext({ app });
  const out = await requestStorage.run(c, () =>
    invoke((app as any).apiTree["auth.webauthn"], "POST", "/login/challenge")
  ) as any;

  assertEquals(typeof out.token, "string");
  assertEquals(out.publicKey.rpId, "localhost");
  assertEquals(typeof out.publicKey.challenge, "string");
  assertEquals(out.publicKey.allowCredentials, undefined);
  assertEquals(challenges.length, 1);
  assertEquals(challenges[0].type, "login");
  assertEquals(challenges[0].usr_id, 0);
  assertEquals(execs.length, 0);
});

Deno.test("auth.webauthn: rpId defaults to the host of core.url without www", async () => {
  const { app } = makeApp();
  app.settings = { core: { url: "https://www.example.ch/" }, "auth.webauthn": {} };
  const c = await testContext({ app });
  const out = await requestStorage.run(c, () =>
    invoke((app as any).apiTree["auth.webauthn"], "POST", "/login/challenge")
  ) as any;
  assertEquals(out.publicKey.rpId, "example.ch");
});

Deno.test("auth.webauthn: cron purges expired challenges", async () => {
  const { app, execs } = makeApp();
  await cron.challenges.run(app as any);
  assertEquals(execs.length, 1);
});

Deno.test("auth.webauthn: a user has the factor only with a passkey of their own", async () => {
  const db = new Db("sqlite::memory:");
  await db.migrate(dbSchema);
  await db.loadTables();
  try {
    const app = { db } as never;
    const has = authFactors[0].has!;
    assertEquals(await has(app, 7), false);
    await db.table("webauthn_credential").insert({ usr_id: 7, credential_id: "c", public_key: "k", sign_count: 0, created: 1 });
    assertEquals([await has(app, 7), await has(app, 8)], [true, false]);
  } finally {
    await db.close();
  }
});

Deno.test("auth.webauthn: the request origin passes under rpId or in core.hosts", async () => {
  const app = { settings: { core: { hosts: "polarity.se", url: "https://schwups.ch/" } } };
  const at = (url: string) => expectedOrigins({ app, req: { url: new URL(url) } } as any, "polarity.ch");
  assertEquals(await at("https://schwups.ch/x"), ["https://schwups.ch"], "the host of core.url counts too");
  assertEquals(await at("https://www.polarity.ch:8443/x"), ["https://www.polarity.ch:8443"]);
  assertEquals(await at("https://polarity.se/x"), ["https://polarity.se"]);
  assertEquals(await at("https://evil.ch/x"), []);
});

Deno.test("auth.webauthn: /.well-known/webauthn lists core.hosts as related origins", async () => {
  let route: (e: any) => Promise<void> = async () => {};
  const app = { settings: { core: { hosts: "polarity.se\n*.polarity.se www.polarity.se", url: "https://polarity.se/" } }, on: (_: string, fn: any) => route = fn };
  init(app as any, { signal: new AbortController().signal });
  assertEquals(await route({ ctx: { req: { appPath: "other" } } }), undefined);
  const out = await route({ ctx: { req: { appPath: ".well-known/webauthn" } } }).catch((e) => e);
  assertEquals(JSON.parse(out.body), { origins: ["https://polarity.se", "https://www.polarity.se"] });
});
