import { assertEquals, assertRejects } from "@std/assert";
import { fakeSettings } from "@qino/qino/tests";

import { domainHosts } from "../plugin.ts";

import type { App } from "@qino/qino";

const app = (servers: string) => ({ settings: fakeSettings({ "fin.hosting.plesk": fakeSettings({ servers }) }) }) as unknown as App;

Deno.test("fin.hosting.plesk: each server a host, its websites with their aliases, signed in by password or key", async () => {
  const fetch = globalThis.fetch;
  const asked: string[] = [];
  globalThis.fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    asked.push(`${input} ${headers.get("authorization") ?? headers.get("x-api-key")}`);
    if (String(input).includes("down")) return Promise.resolve(Response.json({ errors: ["no"] }, { status: 401 }));
    return Promise.resolve(Response.json([
      { name: "example.ch", ascii_name: "example.ch", base_domain_id: 0, aliases: [{ name: "beispiel.ch", ascii_name: "beispiel.ch" }] },
      { name: "shop.example.ch", ascii_name: "shop.example.ch", base_domain_id: 1, aliases: [] },
      { name: "müller.ch", ascii_name: "xn--mller-kva.ch" },
    ]));
  };
  try {
    const hosts = await domainHosts(app("https://admin:p%40ss@s3.example.com:8443\nhttps://K3Y@down.example.com:8443"));
    assertEquals(hosts.map((h) => h.name), ["plesk:s3.example.com", "plesk:down.example.com"]);
    assertEquals(await hosts[0].domains(), [
      { name: "example.ch", aliases: ["beispiel.ch"] },
      { name: "shop.example.ch", aliases: [] },
      { name: "xn--mller-kva.ch", aliases: [] },
    ]);
    assertEquals(asked[0], `https://s3.example.com:8443/api/v2/domains Basic ${btoa("admin:p@ss")}`);
    await assertRejects(() => hosts[1].domains(), Error, "Plesk down.example.com answered 401");
    assertEquals(asked[1], "https://down.example.com:8443/api/v2/domains K3Y");
  } finally {
    globalThis.fetch = fetch;
  }
  assertEquals(await domainHosts(app("")), []);
});
