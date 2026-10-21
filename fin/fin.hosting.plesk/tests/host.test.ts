import { assertEquals, assertRejects } from "@std/assert";

import { domainSourceTypes } from "../plugin.ts";


const sites = (url: string | null, user: string | null, secret: string) => domainSourceTypes.plesk.domains({ name: "s3", type: "plesk", url, user, secret });

Deno.test("fin.hosting.plesk: a server's websites with their aliases, signed in by password or key", async () => {
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
    assertEquals(await sites("https://s3.example.com:8443", "admin", "p@ss"), [
      { name: "example.ch", aliases: ["beispiel.ch"] },
      { name: "shop.example.ch", aliases: [] },
      { name: "xn--mller-kva.ch", aliases: [] },
    ]);
    assertEquals(asked[0], `https://s3.example.com:8443/api/v2/domains Basic ${btoa("admin:p@ss")}`);
    await assertRejects(() => sites("https://down.example.com:8443", null, "K3Y"), Error, "Plesk down.example.com answered 401");
    assertEquals(asked[1], "https://down.example.com:8443/api/v2/domains K3Y");
  } finally {
    globalThis.fetch = fetch;
  }
  await assertRejects(() => sites(null, null, "K3Y"), Error, "no URL");
});
