const ALPHABET = "234567abcdefghijklmnopqrstuvwxyz";
const ENCODER = new TextEncoder();

/** A deterministic AT Protocol TID for an opaque idempotency key. */
export async function tid(key: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", ENCODER.encode(key)));
  let value = 0n;
  for (const byte of bytes.subarray(0, 8)) value = value << 8n | BigInt(byte);
  let result = "";
  for (let i = 0; i < 13; i++) {
    result = ALPHABET[Number(value & 31n)] + result;
    value >>= 5n;
  }
  return result;
}
