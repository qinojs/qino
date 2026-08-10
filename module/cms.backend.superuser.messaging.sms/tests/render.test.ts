import { assert, assertEquals, assertStringIncludes, fakeT } from "../../core/tests/deps.ts";
import { name, needs } from "../plugin.ts";
import { provider } from "../render.ts";

Deno.test("cms.backend.superuser.messaging.sms wires metadata and keeps provider secrets out of HTML", async () => {
  assertEquals(name, "cms.backend.superuser.messaging.sms");
  assertEquals(needs, ["cms.backend.superuser.messaging", "messaging.sms"]);
  const node = {
    app: {
      t: fakeT,
      settings: {
        "messaging.sms": {
          provider: {
            type: "twilio",
            twilio: { accountSid: "AC123", apiKeySid: "SK123", apiKeySecret: "private", authToken: "fallback" },
            http: {},
          },
        },
      },
    },
  } as never;
  const output = String(await provider(node));
  assertStringIncludes(output, "AC123");
  assertStringIncludes(output, "SK123");
  assert(!output.includes("private"));
  assert(!output.includes("fallback"));
});
