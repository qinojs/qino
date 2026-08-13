import { $item } from "@qino/qino";
import { assert, assertEquals, assertStringIncludes, fakeT } from "@qino/qino/tests";

import api from "../nodeApi.ts";
import { bot as renderBot } from "../render.ts";

Deno.test("Telegram bot token is validated once and cannot be replaced here", async () => {
  let token: unknown;
  const settings = {
    "messaging.telegram": {
      get botToken() { return token; },
    },
    [$item]: {
      sub: () => ({
        item: () => ({
          set: (value: unknown) => void (token = value),
          remove: () => void (token = undefined),
        }),
      }),
    },
  };
  const node = { app: { settings, t: fakeT } } as never;
  const original = globalThis.fetch;
  globalThis.fetch = (input: string | URL | Request) => {
    const valid = String(input).includes("good-token");
    return Promise.resolve(Response.json(valid
      ? { ok: true, result: { username: "qino" } }
      : { ok: false, error_code: 401, description: "Unauthorized" }, { status: valid ? 200 : 401 }));
  };

  try {
    assertEquals(await api(node, { botToken: "bad-token" }), { ok: false, message: "Unauthorized" });
    assertEquals(token, undefined);
    assertEquals(await api(node, { botToken: "good-token" }), { ok: true, message: "Bot token saved." });
    assertEquals(token, "good-token");
    assertEquals(await api(node, { botToken: "bad-token" }), { ok: false, message: "The bot token is already configured." });
    assertEquals(token, "good-token");
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("Telegram token form is only rendered before configuration", async () => {
  const empty = { app: { settings: { "messaging.telegram": {} }, t: fakeT } } as never;
  assertStringIncludes(String(await renderBot(empty)), "name=botToken");

  const configured = { app: { settings: { "messaging.telegram": { botToken: "configured" } }, t: fakeT } } as never;
  const original = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(Response.json({ ok: false, error_code: 401, description: "Unauthorized" }, { status: 401 }));
  try {
    const output = String(await renderBot(configured));
    assert(!output.includes("name=botToken"));
    assert(!output.includes("Create a bot with @BotFather"));
  } finally {
    globalThis.fetch = original;
  }
});
