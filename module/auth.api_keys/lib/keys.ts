import { createHash } from "node:crypto";
import { unixTime, randB64 } from "@qino/qino";

import type { App } from "@qino/qino";

const PREFIX = "qk_";

/** New opaque token: `qk_` + 256 random bits, base64url. Shown to the user exactly once. */
export function generateToken(): string {
  return PREFIX + randB64(32);
}

/** SHA-256 hex — the only representation we store, looked up via the unique index.
 *  A 256-bit random token needs no slow hash; a fast digest keeps the lookup indexable. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Public prefix (`qk_ab12cd`) — lets the UI list a key without ever seeing the secret. */
export function keyPrefix(token: string): string {
  return token.slice(0, 9);
}

/** Look a token up to its (non-expired) key of an active user. Touches no request/session state. */
export async function verifyToken(app: App, token: string): Promise<{ id: number; usrId: number } | null> {
  if (!token.startsWith(PREFIX)) return null;
  const row = await app.db.row`SELECT k.id, k.usr_id, k.expires FROM api_key k
    JOIN usr u ON u.id = k.usr_id AND u.active = ${true}
    WHERE k.hash = ${hashToken(token)}`;
  if (!row || (row.expires && Number(row.expires) < unixTime())) return null;
  return { id: Number(row.id), usrId: Number(row.usr_id) };
}
