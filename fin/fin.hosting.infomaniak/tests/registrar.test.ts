import { assertEquals, assertRejects } from "@std/assert";
import { fakeSettings } from "@qino/qino/tests";

import { domainRegistrar } from "../plugin.ts";

import type { App } from "@qino/qino";

const app = (token: string, account?: number) =>
  ({ settings: fakeSettings({ "fin.hosting.infomaniak": fakeSettings({ token, account }) }) }) as unknown as App;

Deno.test("fin.hosting.infomaniak: the domains of every page, of the account asked for, with their end", async () => {
  const fetch = globalThis.fetch;
  const asked: string[] = [];
  globalThis.fetch = (input, init) => {
    asked.push(`${input} ${new Headers(init?.headers).get("authorization")}`);
    const page = Number(new URL(String(input)).searchParams.get("page"));
    const data = page === 1
      ? [{ service_name: "domain", customer_name: "example.ch", account_id: 1, expired_at: 1798761600 },
        { service_name: "hosting", customer_name: "web", account_id: 1 }]
      : [{ service_name: "domain", customer_name: "other.ch", account_id: 2, expired_at: null }];
    return Promise.resolve(Response.json({ result: "success", data, page, pages: 2 }));
  };
  try {
    assertEquals(await domainRegistrar.domains(app("t0k")), [
      { name: "example.ch", expires: "2027-01-01" },
      { name: "other.ch", expires: null },
    ]);
    assertEquals(asked[0], "https://api.infomaniak.com/1/products?per_page=500&page=1 Bearer t0k");
    assertEquals((await domainRegistrar.domains(app("t0k", 2))).map((d) => d.name), ["other.ch"]);
    globalThis.fetch = () => Promise.resolve(Response.json({ result: "error", error: { code: "not_authorized" } }, { status: 401 }));
    await assertRejects(() => domainRegistrar.domains(app("bad")), Error, "Infomaniak answered 401");
  } finally {
    globalThis.fetch = fetch;
  }
  await assertRejects(() => domainRegistrar.domains(app("")), Error, "no API token");
});
