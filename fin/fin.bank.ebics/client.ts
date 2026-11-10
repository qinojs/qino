import { createHash, timingSafeEqual, X509Certificate } from "node:crypto";
import { dirname } from "node:path";
import { open } from "node:fs/promises";
import { Client, OrdersH005 } from "@kage0x3b/ebics-client";

import type { Config } from "./config.ts";
import type { BankKeys, EbicsDownloadResponse, EbicsKeyManagementResponse } from "@kage0x3b/ebics-client";

const OK = "000000";
const NO_DATA = "090005";
const MAX_ZIP = 20 * 1024 * 1024;

type ReceiptOrder = Parameters<Client["download"]>[0];
type Receipt = (order: ReceiptOrder, transactionId: string, code: 0 | 1) => Promise<void>;
type WithReceipt = { sendReceipt: Receipt };

/** fsync and rename before telling EBICS that a download was received. */
export async function atomicWrite(path: string, bytes: Uint8Array): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    const file = await Deno.open(temp, { write: true, createNew: true, mode: 0o600 });
    try {
      let offset = 0;
      while (offset < bytes.length) offset += await file.write(bytes.subarray(offset));
      await file.sync();
    } finally {
      file.close();
    }
    await Deno.rename(temp, path);
    const dir = await open(dirname(path), "r");
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  } finally {
    await Deno.remove(temp).catch((error) => {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    });
  }
}

/** Keep the package's encrypted keyring writes atomic and private. */
export function keyStorage(path: string) {
  return {
    read: () => Deno.readTextFile(path),
    write: (data: string) => atomicWrite(path, new TextEncoder().encode(data)),
  };
}

export function clientOf(c: Config): Client {
  const passphrase = Deno.env.get(c.passphraseEnv);
  if (!passphrase) throw new Error(`fin.bank.ebics: missing ${c.passphraseEnv}`);
  return new Client({
    url: c.url, hostId: c.hostId, partnerId: c.partnerId, userId: c.userId,
    passphrase, keyStorage: keyStorage(c.keyring), timeout: 60_000,
  });
}

/** The upstream client silently creates new keys if its encrypted keyring cannot be read. */
export async function requireExistingKeys(client: Client, path: string): Promise<void> {
  const file = await Deno.lstat(path);
  if (!file.isFile || (file.mode != null && (file.mode & 0o077) !== 0)) {
    throw new Error("fin.bank.ebics: keyring must be a private regular file");
  }
  if (!await client.keys()) throw new Error("fin.bank.ebics: keyring cannot be decrypted; refusing to regenerate keys");
}

const normalizeHash = (value: string) => Buffer.from(value.replace(/[\s:]/g, ""), "hex");
const sameHash = (expected: string, actual: Buffer) => timingSafeEqual(normalizeHash(expected), actual);

/** EBICS key digest: SHA-256 over lowercase exponent and modulus hex, separated by a space. */
function publicDigest(mod: Uint8Array, exp: Uint8Array): Buffer {
  const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex").replace(/^0+/, "").toLowerCase();
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

/** Never persist HPB bank keys before both published fingerprints match. */
export async function trustBank(client: Client, c: Config): Promise<void> {
  await requireExistingKeys(client, c.keyring);
  const result = await client.send(OrdersH005.HPB as unknown as Parameters<Client["send"]>[0]) as EbicsKeyManagementResponse;
  if (result.technicalCode !== OK || result.businessCode !== OK) throw new Error(`fin.bank.ebics: HPB rejected (${result.technicalCode}/${result.businessCode})`);
  const { bankX002, bankE002 } = result.bankKeys;
  if (!bankX002 || !bankE002
    || !bankHashMatches(bankX002, c.bankHashes.authentication)
    || !bankHashMatches(bankE002, c.bankHashes.encryption)) {
    throw new Error("fin.bank.ebics: bank key hashes differ from the independently supplied values");
  }
  await client.setBankKeys(result.bankKeys);
}

/** Hold a positive receipt until the payload is durably staged. Exact client version is pinned. */
export async function downloadSafely(client: Client, order: ReceiptOrder, stage: (data: Uint8Array) => Promise<void>): Promise<boolean> {
  const source = Client.prototype.download.toString();
  if (!source.includes("await this.sendReceipt(order, transactionId, 0)")) {
    throw new Error("fin.bank.ebics: client receipt flow changed; review required");
  }
  const internal = client as unknown as WithReceipt;
  const send = internal.sendReceipt.bind(client);
  let receipt: { order: ReceiptOrder; transactionId: string } | undefined;
  internal.sendReceipt = async (current, transactionId, code) => {
    if (code === 0) {
      receipt = { order: current, transactionId };
      return;
    }
    await send(current, transactionId, code);
  };
  try {
    const result = await client.download(order) as EbicsDownloadResponse;
    if (result.technicalCode === NO_DATA || result.businessCode === NO_DATA) return false;
    if (result.technicalCode !== OK || result.businessCode !== OK || !receipt) {
      throw new Error(`fin.bank.ebics: BTD rejected or no receipt (${result.technicalCode}/${result.businessCode})`);
    }
    try {
      if (result.orderData.length > MAX_ZIP) throw new Error("fin.bank.ebics: ZIP exceeds size limit");
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
