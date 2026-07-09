import { createHash } from "node:crypto";
import { unixTime, type App } from "../../core/mod.ts";

const PREFIX = "qk_";

const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

/** New opaque token: `qk_` + 256 random bits, base64url. Shown to the user exactly once. */
export function generateToken(): string {
  return PREFIX + b64url(crypto.getRandomValues(new Uint8Array(32)));
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

/** Look a token up to its (non-expired) key. Touches no request/session state —
 *  the seam bearer auth plugs into; see USAGE.md → "Activating bearer auth". */
export async function verifyToken(app: App, token: string): Promise<{ id: number; usrId: number } | null> {
  if (!token.startsWith(PREFIX)) return null;
  const row = await app.db.row`SELECT id, usr_id, expires FROM api_key WHERE hash = ${hashToken(token)}`;
  if (!row) return null;
  if (row.expires && Number(row.expires) < unixTime()) return null;
  return { id: Number(row.id), usrId: Number(row.usr_id) };
}
