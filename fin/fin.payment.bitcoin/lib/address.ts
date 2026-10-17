import { HDKey } from "@scure/bip32";
import { p2wpkh } from "@scure/btc-signer";

/** Version bytes of an extended public key: zpub (BIP84) or the plain xpub. */
const ZPUB = { private: 0x04b2430c, public: 0x04b24746 };

/**
 * The receiving address `index` of a wallet account, native segwit (bc1q…), as BIP84 derives it:
 * `<account key>/0/<index>`. Only the public key is needed — nothing here can spend.
 */
export function address(key: string, index: number): string {
  const account = HDKey.fromExtendedKey(key.trim(), key.trim().startsWith("zpub") ? ZPUB : undefined);
  const child = account.deriveChild(0).deriveChild(index);
  return p2wpkh(child.publicKey!).address!;
}
