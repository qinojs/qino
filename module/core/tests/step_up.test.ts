// deno-lint-ignore-file no-explicit-any
import { assertEquals, assertRejects, testContext } from "@qino/qino/tests";

import { requireStepUp } from "../lib/auth.ts";
import { ApiError } from "../lib/api/errors.ts";

const now = () => Math.floor(Date.now() / 1000);

const factor = (name: string, over: Record<string, unknown> = {}) =>
  ({ name, label: name, stepUp: true, ...over });

/** A ctx whose session already records these proofs, in an app linking these factors. */
function ctxWith(via: Record<string, number>, factors: unknown[] = [factor("password")], set: Record<string, unknown> = {}) {
  const sess = { data: { core: { userId: () => 7, via: () => via } } };
  return testContext({
    userId: 7,
    sess,
    app: { modules: { linked: () => factors.map((f: any) => ({ name: `auth.${f.name}`, plugin: { authFactors: [f] } })) } },
    set,
  });
}

const thrown = async (p: Promise<unknown>) => await assertRejects(() => p, ApiError) as ApiError;

Deno.test("requireStepUp: a fresh proof passes, and says so in one value", async () => {
  assertEquals(await requireStepUp(await ctxWith({ password: now() - 10 }), { maxAge: 300 }), true);
});

Deno.test("requireStepUp: an old proof throws, offering what would satisfy it", async () => {
  const e = await thrown(requireStepUp(await ctxWith({ password: now() - 1000 }), { maxAge: 300 }));
  assertEquals(e.code, "step_up_required");
  assertEquals(e.status, 403);
  // the module travels along: it is where the browser loads `pub/stepup.js` from
  assertEquals((e.data as any).factors, [{ name: "password", label: "password", module: "auth.password" }]);
  assertEquals((e.data as any).maxAge, 300);
});

Deno.test("requireStepUp: remember and login_as are records of access, not proofs", async () => {
  await thrown(requireStepUp(await ctxWith({ remember: now(), login_as: now() }), { maxAge: 300 }));
});

Deno.test("requireStepUp: a factor without stepUp neither counts nor is offered", async () => {
  const e = await thrown(requireStepUp(await ctxWith({ oauth: now() }, [factor("oauth", { stepUp: false }), factor("password")])));
  assertEquals((e.data as any).factors.map((f: any) => f.name), ["password"]);
});

Deno.test("requireStepUp: someone with no factor at all passes — else they could never set up a first one", async () => {
  assertEquals(await requireStepUp(await ctxWith({}, [factor("password", { has: () => Promise.resolve(false) })])), true);
});

Deno.test("requireStepUp: the offer is ordered, strongest first", async () => {
  const e = await thrown(requireStepUp(await ctxWith({}, [
    factor("backup_codes", { order: 90 }),
    factor("webauthn", { order: 10 }),
    factor("password"), // says nothing, so it lands between them
  ])));
  assertEquals((e.data as any).factors.map((f: any) => f.name), ["webauthn", "password", "backup_codes"]);
});

Deno.test("requireStepUp: only factors the user has are offered", async () => {
  const e = await thrown(requireStepUp(await ctxWith({}, [
    factor("password"),
    factor("totp", { has: () => Promise.resolve(false) }),
    factor("webauthn", { has: () => Promise.resolve(true) }),
  ])));
  assertEquals((e.data as any).factors.map((f: any) => f.name), ["password", "webauthn"]);
});

Deno.test("requireStepUp: a stateless credential is offered nothing — there is no session to prove into", async () => {
  const e = await thrown(requireStepUp(await ctxWith({}, [factor("password")], { statelessAuth: true })));
  assertEquals((e.data as any).factors, []);
});
