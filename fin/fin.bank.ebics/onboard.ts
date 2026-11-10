/** One-time EBICS 3.0 enrolment. Run each command only when the bank requests it. */
import { Client, OrdersH005 } from "@kage0x3b/ebics-client";
import { clientOf, requireExistingKeys, trustBank } from "./client.ts";
import { readConfig } from "./config.ts";

import type { EbicsKeyManagementResponse } from "@kage0x3b/ebics-client";

async function submit(client: Client, order: typeof OrdersH005.INI): Promise<void> {
  const result = await client.send(order as unknown as Parameters<Client["send"]>[0]) as EbicsKeyManagementResponse;
  if (result.technicalCode !== "000000" || result.businessCode !== "000000") {
    throw new Error(`fin.bank.ebics: ${order.orderDetails.AdminOrderType} rejected (${result.technicalCode}/${result.businessCode})`);
  }
}

if (import.meta.main) {
  const [command, path] = Deno.args;
  if (!path || !["keys", "ini", "hia", "hpb"].includes(command)) {
    throw new Error("Usage: deno run --allow-read --allow-write --allow-env --allow-net fin/fin.bank.ebics/onboard.ts keys|ini|hia|hpb /absolute/connection.json");
  }
  const config = await readConfig(path);
  const client = clientOf(config);
  if (command === "keys") {
    try {
      await Deno.lstat(config.keyring);
      throw new Error("fin.bank.ebics: keyring already exists; refusing to replace enrolment keys");
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    const keys = await client.generateKeys({ subject: config.userId });
    const a = keys?.a(), x = keys?.x(), e = keys?.e();
    if (!a || !x || !e) throw new Error("fin.bank.ebics: key generation incomplete");
    console.log(`Partner ID: ${config.partnerId}\nUser ID: ${config.userId}\nA006: ${a.sha256()}\nX002: ${x.sha256()}\nE002: ${e.sha256()}`);
  } else if (command === "ini") {
    await requireExistingKeys(client, config.keyring);
    await submit(client, OrdersH005.INI);
    console.log("INI accepted");
  } else if (command === "hia") {
    await requireExistingKeys(client, config.keyring);
    await submit(client, OrdersH005.HIA);
    console.log("HIA accepted");
  } else {
    await trustBank(client, config);
    console.log("HPB bank keys match the configured independent fingerprints");
  }
}
