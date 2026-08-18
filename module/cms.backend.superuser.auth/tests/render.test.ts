import { assertEquals, assertStringIncludes, fakeSettings, testContext } from "@qino/qino/tests";

import { cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };

const { name, dependencies } = manifest;

const passkey = { name: "webauthn", label: "Passkey", stepUp: true, order: 10 };
const codes = { name: "backup_codes", label: "Backup codes", second: true, stepUp: true, order: 90 };

/** An app declaring two factors, with one verb that always demands a fresh proof. */
function appWith(loginTwoFactor: boolean) {
  return {
    settings: fakeSettings({ core: { loginTwoFactor } }),
    modules: {
      linked: () => [
        { name: "auth.webauthn", plugin: { authFactors: [passkey] } },
        { name: "auth.backup_codes", plugin: { authFactors: [codes] } },
      ],
    },
    apiTree: {
      "auth.totp": {
        enrol: { post: { description: "Set up an authenticator app", access: () => true, requireStepUp: true, execute: () => ({}) } },
        verify: { post: { description: "Prove it is you", access: () => true, execute: () => ({}) } },
      },
    },
    db: { query: () => [] },
  };
}

const guest = { data: { core: { userId: () => 0, pending: () => undefined, via: () => ({ password: 1700000000 }) } } };

const render = (app: unknown, ctx: unknown) =>
  // deno-lint-ignore no-explicit-any
  cms.node.render({ app } as any, { ctx } as any).then(String);

Deno.test("cms.backend.superuser.auth: metadata is wired", () => {
  assertEquals(name, "cms.backend.superuser.auth");
  assertEquals(dependencies, ["auth", "cms.backend"]);
});

Deno.test("cms.backend.superuser.auth: the page reads the factor declarations, not a list of its own", async () => {
  const app = appWith(false);
  const out = await render(app, await testContext({ app, sess: guest }));
  assertStringIncludes(out, "Passkey");
  assertStringIncludes(out, "Backup codes");
  assertStringIncludes(out, "opens a session"); // the policy, told where the factors are
});

Deno.test("cms.backend.superuser.auth: it shows the policy and the verbs that demand a proof", async () => {
  const app = appWith(true);
  const out = await render(app, await testContext({ app, sess: guest }));
  assertStringIncludes(out, "<code>core.loginTwoFactor</code>");
  assertStringIncludes(out, "POST auth.totp/enrol"); // declared demand, read out of the api tree
  assertEquals(out.includes("POST auth.totp/verify"), false); // no demand, so not listed
});
