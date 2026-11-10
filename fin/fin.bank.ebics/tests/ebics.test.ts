import { test } from "node:test";
import { assertEquals, assertRejects } from "@std/assert";
import { Client } from "@kage0x3b/ebics-client";
import { downloadSafely, requireKeys } from "../client.ts";

type Order = Parameters<Client["download"]>[0];

function fakeClient(events: string[], data = new Uint8Array([1, 2, 3])): Client {
  const client = Object.create(Client.prototype) as {
    sendReceipt: (_order: Order, id: string, code: 0 | 1) => Promise<void>;
    download: Client["download"];
  };
  client.sendReceipt = async (_order, id, code) => {
    assertEquals(id, "transaction-1");
    events.push(`receipt:${code}`);
  };
  client.download = async (order) => {
    await client.sendReceipt(order, "transaction-1", 0);
    return {
      technicalCode: "000000", businessCode: "000000", orderData: data,
    } as Awaited<ReturnType<Client["download"]>>;
  };
  return client as unknown as Client;
}

const order = { version: "h005", operation: "download", orderDetails: { AdminOrderType: "BTD" } } as Order;

test("EBICS confirms delivery only after durable staging", async () => {
  const events: string[] = [];
  const client = fakeClient(events);
  assertEquals(await downloadSafely(client, order, async (data) => {
    assertEquals(Array.from(data), [1, 2, 3]);
    events.push("staged");
  }), true);
  assertEquals(events, ["staged", "receipt:0"]);
});

test("staging failure requests redelivery instead of confirming delivery", async () => {
  const events: string[] = [];
  const client = fakeClient(events);
  await assertRejects(() => downloadSafely(client, order, async () => {
    events.push("stage-failed");
    throw new Error("disk full");
  }), Error, "disk full");
  assertEquals(events, ["stage-failed", "receipt:1"]);
});

test("an unreadable keyring cannot trigger silent key generation", async () => {
  const client = { keys: async () => null } as unknown as Client;
  await assertRejects(() => requireKeys(client), Error, "refusing to generate keys");
});

// downloadSafely holds back the client's internal receipt: an upgrade must keep this flow
test("the pinned client still confirms a download through sendReceipt", () => {
  const source = Client.prototype.download.toString();
  assertEquals(source.includes("await this.sendReceipt(order, transactionId, 0)"), true);
  assertEquals(typeof (Client.prototype as unknown as { sendReceipt: unknown }).sendReceipt, "function");
});
