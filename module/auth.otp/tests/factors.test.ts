// deno-lint-ignore-file no-explicit-any
import { toTools } from "@qino/qino";
import { assertEquals } from "@qino/qino/tests";

import { api, authFactors } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };

const { name, dependencies } = manifest;

const channel = (name: string, label: string, reach: number) =>
  ({ name, label, reach: () => Promise.resolve(reach), send: () => Promise.resolve(1) });

const appWith = (...list: unknown[]) =>
  ({ modules: { linked: () => list.map((c) => ({ plugin: { messagingChannel: c } })) } }) as any;

Deno.test("auth.otp: module metadata is wired", () => {
  assertEquals(name, "auth.otp");
  assertEquals(dependencies, ["auth", "messaging"]);
  assertEquals(toTools(api).map((tool: { name: string }) => tool.name), ["post", "post_verify"]);
});

Deno.test("auth.otp: one factor per channel, none without channels", () => {
  assertEquals(authFactors(appWith()).length, 0);
  const factors = authFactors(appWith(channel("sms", "SMS", 1), channel("email", "Email", 1)));
  assertEquals(factors.map((f) => f.name), ["sms", "email"]);
  assertEquals(factors.map((f) => f.label), ["SMS code", "Email code"]);
  assertEquals(factors.every((f) => f.stepUp && !f.login), true); // no login until a login can ask twice
});

Deno.test("auth.otp: a channel that cannot reach the user is not something they have", async () => {
  const app = appWith(channel("sms", "SMS", 0), channel("telegram", "Telegram", 2));
  const [sms, telegram] = authFactors(app);
  assertEquals(await sms.has!(app, 7), false);
  assertEquals(await telegram.has!(app, 7), true);
});
