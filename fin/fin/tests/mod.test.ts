import { assertEquals } from "@std/assert";

import { withFinApp } from "../../tests/app.ts";
import { addDays, addMonths, fromMinor, mainCurrency, nameOf, partyOf, toMinor } from "../mod.ts";

Deno.test("days and months on: the month's last day kept, across years", () => {
  assertEquals(addDays("2027-02-28", 1), "2027-03-01");
  assertEquals(addDays("2027-01-01", -1), "2026-12-31");
  assertEquals(addMonths("2027-03-01", 12), "2028-03-01");
  assertEquals(addMonths("2027-01-31", 1), "2027-02-28");
  assertEquals(addMonths("2027-11-15", 3), "2028-02-15");
  assertEquals(addMonths("2028-02-29", 12), "2029-02-28");
  assertEquals(addMonths("2027-03-31", -1), "2027-02-28");
});

Deno.test("minor units in the currency's own decimals", () => {
  assertEquals(fromMinor(47226, "CHF"), 472.26);
  assertEquals(fromMinor(1000, "JPY"), 1000);
  assertEquals(fromMinor(1234, "KWD"), 1.234);
  assertEquals(toMinor(472.26, "CHF"), 47226);
  assertEquals(toMinor(0.1 + 0.2, "EUR"), 30);
  assertEquals(toMinor(1000, "JPY"), 1000);
});

Deno.test("a user as a party: the organization first, the address as far as filled in", () => {
  assertEquals(nameOf({ given_name: "Anna", family_name: "Muster", organization: "" }), "Anna Muster");
  assertEquals(nameOf({ given_name: "Anna", family_name: "Muster", organization: "Muster AG" }), "Muster AG");
  const usr = { family_name: "Muster", street_address: "Seeweg 2", postal_code: "3000", address_country: "" };
  assertEquals(partyOf(usr), { name: "Muster", address: { streetAddress: "Seeweg 2", postalCode: "3000" } });
});

Deno.test("the main currency: the organization's country's, unless set", async () => {
  await withFinApp([], async (app) => {
    assertEquals(await mainCurrency(app), "CHF"); // the test organization is in Switzerland
    await app.settings.identity.organization.address.addressCountry("de");
    assertEquals(await mainCurrency(app), "EUR");
    await app.settings.fin.mainCurrency("usd");
    assertEquals(await mainCurrency(app), "USD");
    await app.settings.fin.mainCurrency("");
    await app.settings.identity.organization.address.addressCountry("");
    assertEquals(await mainCurrency(app), undefined);
  });
});
