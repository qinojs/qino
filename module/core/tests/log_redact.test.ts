import { assertEquals } from "./deps.ts";
import { redactQuery } from "../lib/ctx/init.ts";

Deno.test("log: query values that grant access are redacted, the rest is kept", () => {
  const cases: [string, string][] = [
    // a signed dbFile link stays replayable once it is in the log; short values vanish entirely
    ["https://x.tld/dbFile/7/a.jpg?exp=123&sig=abc", "https://x.tld/dbFile/7/a.jpg?exp=123&sig=-----"],
    // long ones keep a prefix: recognisable across log lines, useless as a credential
    ["https://x.tld/a?sig=abcdefghijklmnopqrstuvwxyz", "https://x.tld/a?sig=abcdef%E2%80%A6%2826%29"],
    // OAuth callback: code and state are single-use credentials
    ["https://x.tld/cb?code=abc&state=xyz&err=0", "https://x.tld/cb?code=-----&state=-----&err=0"],
    ["https://x.tld/a?api_token=t&password=p", "https://x.tld/a?api_token=-----&password=-----"],
    // anchored, so these are not secrets
    ["https://x.tld/a?design=flat&postcode=8000", "https://x.tld/a?design=flat&postcode=8000"],
    // what makes a request log useful stays readable
    ["https://x.tld/shop?q=schuhe&page=2", "https://x.tld/shop?q=schuhe&page=2"],
    ["https://x.tld/a/b", "https://x.tld/a/b"],
    ["", ""],
    ["not a url ?x=1", "not a url ?x=1"],
  ];
  for (const [input, want] of cases) assertEquals(redactQuery(input), want, input);
});
