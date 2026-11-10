import { createHash } from "node:crypto";
import { fs } from "@qino/qino";
import { ingestZip } from "@qino/qino/fin.bank.camt";

import { atomicWrite, clientOf, downloadSafely, ebics, requireKeys, submit, trustBank } from "./client.ts";
import { config } from "./config.ts";

import type { App } from "@qino/qino";
import type { Config } from "./config.ts";

type Result = { added: number; matched: number; failed: string[] };

/** Import the deliveries already confirmed to the bank. One that cannot be read is moved to
 *  `failed/` for a person to look at, so it does not hold up the ones after it. */
async function importPending(app: App, c: Config, signal?: AbortSignal): Promise<Result> {
  const result: Result = { added: 0, matched: 0, failed: [] };
  for (const sub of ["archive/", "failed/"]) await fs.mkdir(c.spool + sub, { mode: 0o700 });
  for (const file of await fs.list(c.spool)) {
    if (!file.isFile || !/^[0-9a-f]{64}\.zip$/.test(file.name)) continue;
    signal?.throwIfAborted();
    const path = c.spool + file.name;
    try {
      const { added, matched } = await ingestZip(app, await fs.bytes(path));
      result.added += added;
      result.matched += matched;
      await fs.rename(path, `${c.spool}archive/${file.name}`);
    } catch (error) {
      console.error(`fin.bank.ebics: ${file.name}`, error);
      result.failed.push(file.name);
      await fs.rename(path, `${c.spool}failed/${file.name}`);
    }
  }
  return result;
}

/** Download what the configured camt.054 BTF offers and import it; undefined without a connection. */
export async function sync(app: App, signal?: AbortSignal): Promise<{ added: number; matched: number } | undefined> {
  const c = await config(app);
  if (!c) return;
  const earlier = await importPending(app, c, signal);
  const client = await clientOf(c);
  await trustBank(client, c);
  signal?.throwIfAborted();
  const order = (await ebics()).OrdersH005.genericDownload({
    serviceName: c.btf.serviceName, scope: c.btf.scope,
    serviceOption: c.btf.serviceOption, msgName: "camt.054",
    msgVersion: c.btf.messageVersion, containerType: "ZIP",
  });
  // Named by content: a redelivery overwrites its own copy
  await downloadSafely(client, order, (data) => atomicWrite(`${c.spool}${createHash("sha256").update(data).digest("hex")}.zip`, data));
  const next = await importPending(app, c, signal);
  const failed = [...earlier.failed, ...next.failed];
  if (failed.length) throw new Error(`fin.bank.ebics: moved to failed/: ${failed.join(", ")}`);
  return { added: earlier.added + next.added, matched: earlier.matched + next.matched };
}

export type Step = "keys" | "ini" | "hia" | "hpb";

/** One step of the one-time enrolment, in this order: keys, ini, hia, then the bank activates the
 *  user, then hpb. `keys` answers the fingerprints for the bank's initialisation letter. */
export async function enrol(app: App, step: Step): Promise<Record<string, string> | undefined> {
  const c = await config(app);
  if (!c) throw new Error("fin.bank.ebics: no connection configured");
  const client = await clientOf(c);
  if (step === "hpb") {
    await trustBank(client, c);
    return;
  }
  if (step !== "keys") {
    await requireKeys(client);
    await submit(client, step === "ini" ? "INI" : "HIA");
    return;
  }
  if (await fs.stat(c.keyring, { ttl: 0 })) throw new Error("fin.bank.ebics: keyring exists; refusing to replace enrolment keys");
  const keys = await client.generateKeys({ subject: c.userId });
  const a = keys?.a(), x = keys?.x(), e = keys?.e();
  if (!a || !x || !e) throw new Error("fin.bank.ebics: key generation incomplete");
  return { partnerId: c.partnerId, userId: c.userId, A006: a.sha256(), X002: x.sha256(), E002: e.sha256() };
}
