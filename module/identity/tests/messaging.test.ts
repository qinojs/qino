import { assertEquals } from "@std/assert";

import { messagingPlaceholders } from "../lib/messaging.ts";

import type { App } from "@qino/qino";

const settings = {
  identity: {
    name: "Qino & Co",
    organization: { name: "Qino AG", address: { streetAddress: "Bahnhofstrasse 1", postalCode: "8001", addressLocality: "Zürich" } },
    brand: { primaryColor: "#0a5" },
    contact: { email: "" },
  },
};
// nothing was ever uploaded, so the assets have nothing to answer with
const db = { table: () => ({ get: () => Promise.resolve(undefined) }) };
const app = { settings, db, url: () => Promise.resolve("https://qino.test/") } as unknown as App;
const value = (name: string) => messagingPlaceholders[name](app, {});

Deno.test("identity: a settings leaf is escaped in markup, an empty one leaves the hole", async () => {
  assertEquals(await value("brand"), { text: "Qino & Co", html: "Qino &amp; Co" });
  assertEquals(await value("primaryColor"), { text: "#0a5", html: "#0a5" });
  assertEquals(await value("contactEmail"), undefined);
  assertEquals(await value("brandUrl"), undefined);
});

Deno.test("identity: the address is one line in text and broken in markup", async () => {
  assertEquals(await value("orgAddress"), {
    text: "Qino AG, Bahnhofstrasse 1, 8001 Zürich",
    html: "Qino AG<br>Bahnhofstrasse 1<br>8001 Zürich",
  });
});

Deno.test("identity: an asset nobody uploaded stays empty", async () => {
  assertEquals(await value("logo"), undefined);
  assertEquals(await value("logoUrl"), undefined);
});
