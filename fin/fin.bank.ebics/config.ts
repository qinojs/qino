import type { App } from "@qino/qino";

export type Config = {
  url: string;
  hostId: string;
  partnerId: string;
  userId: string;
  passphraseEnv: string;
  bankX002: string;
  bankE002: string;
  btf: { serviceName: string; scope: string; serviceOption?: string; messageVersion: string };
  keyring: string;
  spool: string;
};

// Settings are read leaf by leaf: awaiting a branch does not guarantee its children are loaded.
const str = async (value: unknown) => String(await value ?? "").trim();

/** The connection, or undefined while none is set up. No bank name is special. */
export async function config(app: App): Promise<Config | undefined> {
  const s = app.settings["fin.bank.ebics"];
  const [url, hostId, partnerId, userId, passphraseEnv, bankX002, bankE002, service, scope, option, version] = await Promise.all([
    str(s.url), str(s.hostId), str(s.partnerId), str(s.userId), str(s.passphraseEnv), str(s.bankX002), str(s.bankE002),
    str(s.btfService), str(s.btfScope), str(s.btfOption), str(s.btfVersion),
  ]);
  if (!url) return;
  if (new URL(url).protocol !== "https:") throw new Error("fin.bank.ebics: HTTPS endpoint required");
  if (!hostId || !partnerId || !userId) throw new Error("fin.bank.ebics: missing EBICS identifiers");
  if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(passphraseEnv)) throw new Error("fin.bank.ebics: invalid passphrase variable");
  for (const hash of [bankX002, bankE002]) {
    if (!/^[\da-f]{64}$/i.test(hash.replace(/[\s:]/g, ""))) throw new Error("fin.bank.ebics: invalid bank key hash");
  }
  if (!/^[A-Z0-9]{3}$/.test(service) || !/^[A-Z0-9]{2,3}$/.test(scope) || !/^\d{2,3}$/.test(version)
    || (option && !/^[A-Z0-9]{3,10}$/.test(option))) {
    throw new Error("fin.bank.ebics: invalid camt.054 BTF");
  }
  const dir = app.modules.get("fin.bank.ebics")!.data;
  return {
    url, hostId, partnerId, userId, passphraseEnv, bankX002, bankE002,
    btf: { serviceName: service, scope, serviceOption: option || undefined, messageVersion: version },
    keyring: `${dir}keys.json`,
    spool: `${dir}incoming/`,
  };
}
