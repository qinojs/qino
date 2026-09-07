import { assertEquals } from "@std/assert";

import { templatePlaceholders } from "../lib/template.ts";

import type { App } from "@qino/qino";

const app = { settings: { identity: {
  name: "Qino",
  contact: { telephone: "+41 44 123 45 67", email: "" },
  organization: { address: { addressLocality: "Zürich" } },
} } } as unknown as App;

Deno.test("identity: CMS templates receive explicitly public identity settings", async () => {
  assertEquals(await templatePlaceholders["contact.telephone"](app, undefined), { text: "+41 44 123 45 67" });
  assertEquals(await templatePlaceholders["organization.address.addressLocality"](app, undefined), { text: "Zürich" });
  assertEquals(await templatePlaceholders["contact.email"](app, undefined), undefined);
});
