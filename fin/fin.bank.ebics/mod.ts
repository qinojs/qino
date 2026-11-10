import { createHash } from "node:crypto";
import { join } from "node:path";
import { OrdersH005 } from "@kage0x3b/ebics-client";
import { ingestZip } from "@qino/qino/fin.bank.camt";

import { atomicWrite, clientOf, downloadSafely, trustBank } from "./client.ts";
import { readConfig } from "./config.ts";

import type { App } from "@qino/qino";
import type { Config } from "./config.ts";

/** Read, archive and deduplicate the deliveries already confirmed to the bank. */
async function importPending(app: App, c: Config): Promise<{ added: number; matched: number }> {
  let added = 0, matched = 0;
  await Deno.mkdir(c.spool, { recursive: true, mode: 0o700 });
  await Deno.mkdir(join(c.spool, "archive"), { recursive: true, mode: 0o700 });
  for await (const file of Deno.readDir(c.spool)) {
    if (!file.isFile || !/^[0-9a-f]{64}\.zip$/.test(file.name)) continue;
    const path = join(c.spool, file.name);
    if ((await Deno.stat(path)).size > 20 * 1024 * 1024) throw new Error(`fin.bank.ebics: oversized ${file.name}`);
    const result = await ingestZip(app, await Deno.readFile(path));
    await Deno.rename(path, join(c.spool, "archive", file.name));
    added += result.added;
    matched += result.matched;
  }
  return { added, matched };
}

/** Download whatever camt.054 BTF this EBICS connection offers, then import it. */
export async function sync(app: App, configPath: string): Promise<{ added: number; matched: number }> {
  const c = await readConfig(configPath);
  const earlier = await importPending(app, c);
  const client = clientOf(c);
  await trustBank(client, c);
  const order = OrdersH005.genericDownload({
    serviceName: c.btf.serviceName, scope: c.btf.scope,
    serviceOption: c.btf.serviceOption, msgName: "camt.054",
    msgVersion: c.btf.messageVersion, containerType: "ZIP",
  });
  await downloadSafely(client, order as unknown as Parameters<typeof downloadSafely>[1], async (data) => {
    const name = createHash("sha256").update(data).digest("hex") + ".zip";
    const path = join(c.spool, name);
    try {
      await Deno.stat(path);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      await atomicWrite(path, data);
    }
  });
  const next = await importPending(app, c);
  return { added: earlier.added + next.added, matched: earlier.matched + next.matched };
}
