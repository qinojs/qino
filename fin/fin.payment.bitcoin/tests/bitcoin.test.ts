import { assertEquals, assertStringIncludes } from "@std/assert";
import { create, methods, slip, sync } from "@qino/qino/fin.payment";

import { withFinApp } from "../../tests/app.ts";
import { withFetch } from "../../tests/fetch.ts";
import { address } from "../lib/address.ts";

import type { App } from "@qino/qino";

/** The BIP84 test vector's account key. */
const ZPUB = "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";

Deno.test("addresses are derived as BIP84 does", () => {
  assertEquals(address(ZPUB, 0), "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu");
  assertEquals(address(ZPUB, 1), "bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g");
});

const withApp = (fn: (app: App) => Promise<void>) =>
  withFinApp(["fin.payment", "fin.payment.bitcoin"], async (app) => {
    await app.settings["fin.payment.bitcoin"].xpub(ZPUB);
    await app.settings["fin.payment.bitcoin"].esplora("https://esplora.test/api");
    await fn(app);
  });

/** An Esplora server: a price, a tip, and what arrived at addresses. */
function esplora(chain: { tip: number; txs: Record<string, unknown[]> }) {
  return (url: URL) => {
    if (url.pathname === "/api/v1/prices") return { CHF: 50000, EUR: 52000 };
    if (url.pathname === "/api/blocks/tip/height") return chain.tip;
    const to = url.pathname.match(/^\/api\/address\/(\w+)\/txs$/)?.[1];
    if (to) return chain.txs[to] ?? [];
  };
}

const tx = (to: string, value: number, height?: number) =>
  ({ status: { confirmed: height != null, block_height: height }, vout: [{ scriptpubkey_address: to, value }] });

Deno.test("an address per payment, the price fixed in satoshis, seen, then confirmed", async () => {
  await withApp(async (app) => {
    const chain = { tip: 100, txs: {} as Record<string, unknown[]> };
    await withFetch(esplora(chain), async () => {
      assertEquals((await methods(app, { amount: 1, currency: "CHF" })).map((m) => m.method), ["bitcoin"]);
      assertEquals(await methods(app, { amount: 1, currency: "JPY" }), []); // no price, no offer
      const { id } = await create(app, { method: "bitcoin", amount: 10000, currency: "CHF", return: "/" }); // CHF 100
      const to = address(ZPUB, id);
      assertEquals(await app.db.one`SELECT external_id FROM payment WHERE id = ${id}`, to);
      assertStringIncludes((await slip(app, id))!, `bitcoin:${to}?amount=0.00200000`);

      chain.txs[to] = [tx(to, 200000)];
      assertEquals([(await sync(app, id))?.status, (await sync(app, id))?.paid], ["processing", 0]);
      chain.txs[to] = [tx(to, 200000, 100)];
      const paid = await sync(app, id);
      assertEquals([paid?.status, paid?.paid], ["paid", 10000]);
    });
  });
});

Deno.test("nothing in time: expired", async () => {
  await withApp(async (app) => {
    await withFetch(esplora({ tip: 1, txs: {} }), async () => {
      const { id } = await create(app, { method: "bitcoin", amount: 100, currency: "CHF", return: "/" });
      const data = JSON.parse(String(await app.db.one`SELECT data FROM payment WHERE id = ${id}`));
      await app.db.exec`UPDATE payment SET data = ${JSON.stringify({ ...data, until: 1 })} WHERE id = ${id}`;
      assertEquals((await sync(app, id))?.status, "expired");
    });
  });
});
