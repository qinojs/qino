import { assertEquals } from "./deps.ts";

import { uaInfo } from "../lib/userAgent.ts";

Deno.test("uaInfo classifies browser, os and device", () => {
  assertEquals(
    uaInfo("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"),
    { browser: "Safari", version: "17.0", os: "iOS", mobile: true, bot: false },
  );
  assertEquals(
    uaInfo("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"),
    { browser: "Chrome", version: "126.0", os: "Windows", mobile: false, bot: false },
  );
  const ios = (app: string) => uaInfo(`Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ${app} Mobile/15E148 Safari/604.1`);
  assertEquals(ios("GSA/438.6.976963367"), { browser: "Safari", version: "", os: "iOS", mobile: true, bot: false });
  assertEquals([ios("CriOS/140.0").browser, ios("FxiOS/142.0").browser], ["Chrome", "Firefox"]);
  assertEquals(uaInfo("Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Claude/1.2.3 Chrome/140.0 Safari/537.36").browser, "Claude");
  assertEquals(uaInfo("Googlebot/2.1").bot, true);
  for (const ua of ["Go-http-client/1.1", "curl/8.5.0", "python-requests/2.31", "Apache-HttpClient/4.5", "okhttp/4.12"]) {
    assertEquals(uaInfo(ua).bot, true, ua);
  }
  assertEquals(uaInfo(""), { browser: "-", version: "", os: "", mobile: false, bot: true });
});
