import { AccessError, invoke, toTools, requestStorage } from "@qino/qino";
import { assertEquals, assertRejects, testContext } from "@qino/qino/tests";

import { api, cron, settingsSchema } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };

const { name } = manifest;

function makeApp() {
  const challenges: Record<string, unknown>[] = [];
  const execs: Array<[string, unknown[]]> = [];
  const app = {
    settings: { "auth.webauthn": { rpId: "localhost", rpName: "Qino" } },
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
  assertEquals(settingsSchema.properties.rpName.type, "string");
});

Deno.test("auth.webauthn: api exposes expected api endpoints", () => {
  const tools = toTools(api);
  assertEquals(tools.map((tool) => tool.name), [
    "post_register_challenge",
    "post_register_verify",
    "post_login_challenge",
    "post_login_verify",
    "post_confirm_challenge",
    "post_confirm_verify",
    "get_credentials",
    "delete_credential",
  ]);

  const registerVerify = tools.find((tool) => tool.name === "post_register_verify");
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

  const loginVerify = tools.find((tool) => tool.name === "post_login_verify");
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
    invoke((app as any).apiTree["auth.webauthn"], "POST", "/login/challenge", { email: " nobody@example.test " })
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

Deno.test("auth.webauthn: cron purges expired challenges", async () => {
  const { app, execs } = makeApp();
  await cron.challenges.run(app as any);
  assertEquals(execs.length, 1);
});
