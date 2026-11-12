import { test } from "node:test";
import { assertEquals } from "@std/assert";

import { templatePlaceholders } from "../lib/template.ts";

import type { App } from "@qino/qino";

const app = { settings: { identity: {
  name: "Qino",
  contact: { telephone: "+41 44 123 45 67", email: "" },
  organization: { address: { addressLocality: "Zürich" } },
} } } as unknown as App;

test("identity: CMS templates receive explicitly public identity settings", async () => {
  assertEquals(await templatePlaceholders["contact.telephone"](app, undefined), { text: "+41 44 123 45 67" });
  assertEquals(await templatePlaceholders["organization.address.addressLocality"](app, undefined), { text: "Zürich" });
  assertEquals(await templatePlaceholders["contact.email"](app, undefined), undefined);
});

test("identity: a vector logo goes into mail rasterized, other images as they are", async () => {
  const logo = (mime: string) => ({
    ...app,
    url: () => Promise.resolve("https://qino.test/"),
    db: { table: () => ({ get: () => Promise.resolve({ $get: () => 1 }) }) },
    dbFiles: { file: () => ({
      ensureVs: () => Promise.resolve({ mime }),
      url: (options: Record<string, unknown>) => Promise.resolve(`/dbFile/1/${Object.entries(options).map(([k, v]) => `${k}-${v}`).join("/")}/logo`),
    }) },
  }) as unknown as App;
  assertEquals(String((await templatePlaceholders["brand.logo"](logo("image/svg+xml"), undefined))?.html),
    `<img src="https://qino.test/dbFile/1/h-80/fmt-png/logo" alt="Qino" height=40>`);
  assertEquals(String((await templatePlaceholders["brand.logo"](logo("image/png"), undefined))?.html),
    `<img src="https://qino.test/dbFile/1/h-80/logo" alt="Qino" height=40>`);
});
