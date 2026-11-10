import { createHash, timingSafeEqual, X509Certificate } from "node:crypto";
import { dirname } from "node:path";
import { open } from "node:fs/promises";
import { Client, OrdersH005 } from "@kage0x3b/ebics-client";
import { fs, sys } from "@qino/qino";

import type { Config } from "./config.ts";
import type { BankKeys } from "@kage0x3b/ebics-client";

const OK = "000000";
const NO_DATA = "090005";

// The client's own orders lack the index signature of its OrderLike, hence one cast where they go in
type Order = Parameters<Client["download"]>[0];
type KeyOrder = typeof OrdersH005.INI;
type Receipt = (order: Order, transactionId: string, code: 0 | 1) => Promise<void>;

/** Written, fsynced and renamed: what EBICS is told it received survives a crash. */
export async function atomicWrite(path: string, bytes: Uint8Array): Promise<void> {
  const temp = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    const file = await open(temp, "wx", 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    await fs.rename(temp, path);
    const dir = await open(dirname(path), "r");
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  } finally {
    await fs.remove(temp);
  }
}

export async function clientOf(c: Config): Promise<Client> {
  const passphrase = sys.env(c.passphraseEnv);
  if (!passphrase) throw new Error(`fin.bank.ebics: missing ${c.passphraseEnv}`);
  await fs.mkdir(dirname(c.keyring), { mode: 0o700 });
  return new Client({
    url: c.url, hostId: c.hostId, partnerId: c.partnerId, userId: c.userId, passphrase, timeout: 60_000,
    keyStorage: { read: () => fs.text(c.keyring), write: (data: string) => atomicWrite(c.keyring, new TextEncoder().encode(data)) },
  });
}

/** The client silently creates new keys if its keyring is missing or cannot be decrypted. */
export async function requireKeys(client: Client): Promise<void> {
  if (!await client.keys()) throw new Error("fin.bank.ebics: no readable keyring; refusing to generate keys");
}

/** An order the bank must accept. */
export async function submit(client: Client, order: KeyOrder): Promise<void> {
  const result = await client.initialization(order as object as Order);
  if (result.technicalCode !== OK || result.businessCode !== OK) {
    throw new Error(`fin.bank.ebics: ${order.orderDetails.AdminOrderType} rejected (${result.technicalCode}/${result.businessCode})`);
  }
}

const sameHash = (expected: string, actual: Buffer) => timingSafeEqual(Buffer.from(expected.replace(/[\s:]/g, ""), "hex"), actual);

/** EBICS key digest: SHA-256 over lowercase exponent and modulus hex, separated by a space. */
function publicDigest(mod: Uint8Array, exp: Uint8Array): Buffer {
  const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex").replace(/^0+/, "");
  return createHash("sha256").update(`${hex(exp)} ${hex(mod)}`).digest();
}

function bankHashMatches(key: NonNullable<BankKeys["bankX002"]>, expected: string): boolean {
  if (key.pem) {
    const pem = Array.isArray(key.pem) ? key.pem[0] : key.pem;
    if (!pem) return false;
    const certificate = new X509Certificate(pem);
    if (sameHash(expected, Buffer.from(certificate.fingerprint256.replaceAll(":", ""), "hex"))) return true;
    const jwk = certificate.publicKey.export({ format: "jwk" });
    if (jwk.kty !== "RSA" || !jwk.n || !jwk.e) return false;
    return sameHash(expected, publicDigest(Buffer.from(jwk.n, "base64url"), Buffer.from(jwk.e, "base64url")));
  }
  return !!key.mod && !!key.exp && sameHash(expected, publicDigest(key.mod, key.exp));
}

/** HPB bank keys are stored only once both independently supplied fingerprints match. */
export async function trustBank(client: Client, c: Config): Promise<void> {
  await requireKeys(client);
  const result = await client.initialization(OrdersH005.HPB as object as Order);
  if (result.technicalCode !== OK || result.businessCode !== OK) throw new Error(`fin.bank.ebics: HPB rejected (${result.technicalCode}/${result.businessCode})`);
  const { bankX002, bankE002 } = result.bankKeys;
  if (!bankX002 || !bankE002 || !bankHashMatches(bankX002, c.bankX002) || !bankHashMatches(bankE002, c.bankE002)) {
    throw new Error("fin.bank.ebics: bank key hashes differ from the independently supplied values");
  }
  await client.setBankKeys(result.bankKeys);
}

/** The positive receipt waits until `stage` has stored the data; a failure asks for redelivery.
 *  The client has no hook for that, so its internal `sendReceipt` is held back (version pinned,
 *  the flow is checked by a test). */
export async function downloadSafely(client: Client, order: object, stage: (data: Uint8Array) => Promise<void>): Promise<boolean> {
  const internal = client as unknown as { sendReceipt: Receipt };
  const send = internal.sendReceipt.bind(client);
  let receipt: { order: Order; transactionId: string } | undefined;
  internal.sendReceipt = async (current, transactionId, code) => {
    if (code === 0) receipt = { order: current, transactionId };
    else await send(current, transactionId, code);
  };
  try {
    const result = await client.download(order as Order);
    if (result.technicalCode === NO_DATA || result.businessCode === NO_DATA) return false;
    if (result.technicalCode !== OK || result.businessCode !== OK || !receipt) {
      throw new Error(`fin.bank.ebics: BTD rejected or no receipt (${result.technicalCode}/${result.businessCode})`);
    }
    try {
      await stage(result.orderData);
    } catch (error) {
      await send(receipt.order, receipt.transactionId, 1);
      throw error;
    }
    await send(receipt.order, receipt.transactionId, 0);
    return true;
  } finally {
    internal.sendReceipt = send;
  }
}
