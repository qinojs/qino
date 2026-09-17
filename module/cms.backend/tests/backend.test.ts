import { assertEquals } from "@qino/qino/tests";

import { uaInfo } from "../lib/backend.ts";

Deno.test("cms.backend: uaInfo classifies browser, os and device", () => {
  assertEquals(
    uaInfo("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"),
    { browser: "Safari", version: "17.0", os: "iOS", mobile: true, bot: false },
  );
  assertEquals(
    uaInfo("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"),
    { browser: "Chrome", version: "126.0", os: "Windows", mobile: false, bot: false },
  );
  assertEquals(uaInfo("Googlebot/2.1").bot, true);
  assertEquals(uaInfo(""), { browser: "-", version: "", os: "", mobile: false, bot: false });
});
