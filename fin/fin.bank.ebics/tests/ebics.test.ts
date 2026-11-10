import { test } from "node:test";
import { assertEquals, assertRejects } from "@std/assert";
import { Client } from "@kage0x3b/ebics-client";
import { downloadSafely, requireExistingKeys } from "../client.ts";

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

test("oversized delivery gets no positive receipt", async () => {
  const events: string[] = [];
  const client = fakeClient(events, new Uint8Array(20 * 1024 * 1024 + 1));
  await assertRejects(() => downloadSafely(client, order, async () => {
    events.push("staged");
  }), Error, "ZIP exceeds size limit");
  assertEquals(events, ["receipt:1"]);
});

test("an unreadable existing keyring cannot trigger silent key regeneration", async () => {
  const path = await Deno.makeTempFile();
  try {
    const client = { keys: async () => null } as unknown as Client;
    await assertRejects(() => requireExistingKeys(client, path), Error, "refusing to regenerate keys");
  } finally {
    await Deno.remove(path);
  }
});
