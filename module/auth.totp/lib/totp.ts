// RFC 6238 over Web Crypto — SHA-1, six digits, thirty-second steps. Not a choice but the shape
// every authenticator app assumes; changing any of it means the codes no longer match.
import { safeEqual, unixTime } from "@qino/qino";

const DIGITS = 6;
const STEP = 30;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; // base32, RFC 4648

/** A fresh shared secret, base32 as the authenticator apps expect it. */
export function secret(bytes = 20): string {
  return encode(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** The `otpauth://` URI behind the QR code. `issuer` is what the app shows above the code. */
export function uri(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const q = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: String(DIGITS), period: String(STEP) });
  return `otpauth://totp/${label}?${q}`;
}

/** Does `code` match the secret right now? One step of tolerance either way for clock drift. */
export async function valid(secret: string, code: string, drift = 1): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const counter = Math.floor(unixTime() / STEP);
  for (let i = -drift; i <= drift; i++) {
    if (safeEqual(code, await at(secret, counter + i))) return true;
  }
  return false;
}

/** The code for one counter step — exported for the tests, which need a known answer. */
export async function at(secret: string, counter: number): Promise<string> {
  const message = new ArrayBuffer(8);
  new DataView(message).setBigUint64(0, BigInt(counter));
  const key = await crypto.subtle.importKey("raw", decode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
  const offset = mac[mac.length - 1] & 0xf; // dynamic truncation, RFC 4226
  const num = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(num % 10 ** DIGITS).padStart(DIGITS, "0");
}

function encode(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    for (bits += 8; bits >= 5; bits -= 5) out += ALPHABET[(value >>> (bits - 5)) & 31];
  }
  return bits ? out + ALPHABET[(value << (5 - bits)) & 31] : out;
}

function decode(base32: string): Uint8Array<ArrayBuffer> {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const char of base32.toUpperCase()) {
    const i = ALPHABET.indexOf(char);
    if (i < 0) continue; // padding and the spaces people paste along
    value = (value << 5) | i;
    if ((bits += 5) >= 8) out.push((value >>> (bits -= 8)) & 255);
  }
  return new Uint8Array(out);
}
