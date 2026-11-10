import { isAbsolute } from "node:path";

export type Config = {
  url: string;
  hostId: string;
  partnerId: string;
  userId: string;
  keyring: string;
  spool: string;
  passphraseEnv: string;
  bankHashes: { authentication: string; encryption: string };
  btf: { serviceName: string; scope: string; serviceOption?: string; messageVersion: string };
};

/** Connection-specific values stay outside Qino's database; no bank name is special. */
export async function readConfig(path: string): Promise<Config> {
  if (!isAbsolute(path)) throw new Error("fin.bank.ebics: config path must be absolute");
  const file = await Deno.lstat(path);
  if (!file.isFile || (file.mode != null && (file.mode & 0o077) !== 0)) {
    throw new Error("fin.bank.ebics: config must be a private regular file");
  }
  const c = JSON.parse(await Deno.readTextFile(path)) as Config;
  if (new URL(c.url).protocol !== "https:") throw new Error("fin.bank.ebics: HTTPS endpoint required");
  if (!isAbsolute(c.keyring) || !isAbsolute(c.spool)) throw new Error("fin.bank.ebics: keyring and spool paths must be absolute");
  if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(c.passphraseEnv)) throw new Error("fin.bank.ebics: invalid passphrase variable");
  if (!c.hostId || !c.partnerId || !c.userId) throw new Error("fin.bank.ebics: missing EBICS identifiers");
  for (const hash of Object.values(c.bankHashes)) {
    if (!/^[\da-f]{64}$/i.test(hash.replace(/[\s:]/g, ""))) throw new Error("fin.bank.ebics: invalid bank key hash");
  }
  if (!/^[A-Z0-9]{3}$/.test(c.btf.serviceName) || !/^[A-Z0-9]{2,3}$/.test(c.btf.scope)
    || !/^\d{2,3}$/.test(c.btf.messageVersion)
    || (c.btf.serviceOption != null && !/^[A-Z0-9]{3,10}$/.test(c.btf.serviceOption))) {
    throw new Error("fin.bank.ebics: invalid camt.054 BTF");
  }
  return c;
}
