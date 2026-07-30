import { createHash } from "node:crypto";
import { randB64, unixTime, type App } from "../../core/mod.ts";

export type Kind = "code" | "access" | "refresh";

/** Opaque secret: 256 random bits, base64url. Access/refresh tokens carry the `qo_` marker so
 *  the `authenticate` hook can claim them without touching foreign Bearer formats. */
const mark = (kind: Kind) => kind === "code" ? "" : "qo_";

/** SHA-256 hex — the only representation stored (unique index). A 256-bit random secret needs no
 *  slow hash; a fast digest keeps the lookup indexable. */
export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

export interface Grant {
  kind: Kind;
  clientId: string;
  usrId: number;
  scope?: string;
  ttl: number;
  redirectUri?: string;
  challenge?: string;
}

/** Issue a secret and store only its hash. Returned exactly once — it can never be read back. */
export async function mint(app: App, g: Grant): Promise<string> {
  const token = mark(g.kind) + randB64(32);
  const now = unixTime();
  await app.db.table("oauth_token").insert({
    hash: hashToken(token),
    kind: g.kind,
    client_id: g.clientId,
    usr_id: g.usrId,
    scope: g.scope ?? "",
    redirect_uri: g.redirectUri ?? "",
    challenge: g.challenge ?? "",
    created: now,
    expires: now + g.ttl,
  });
  sweep(app); // unexpired rows only, fire-and-forget
  return token;
}

/** Look a secret up to its unexpired row of an active user; wrong kind never matches. */
export async function verify(app: App, kind: Kind, token: string) {
  if (!token.startsWith(mark(kind))) return;
  const row = await app.db.row`SELECT t.* FROM oauth_token t
    JOIN usr u ON u.id = t.usr_id AND u.active = ${true}
    WHERE t.hash = ${hashToken(token)} AND t.kind = ${kind}`;
  if (!row || Number(row.expires) < unixTime()) return;
  return row;
}

/** Single-use lookup: the row is gone whether or not the caller succeeds (codes, refresh rotation). */
export async function consume(app: App, kind: Kind, token: string) {
  const row = await verify(app, kind, token);
  if (row) await app.db.table("oauth_token").delete(row.id);
  return row;
}

/** Drop everything a client can no longer redeem. */
export function sweep(app: App): Promise<unknown> {
  return app.db.exec`DELETE FROM oauth_token WHERE expires < ${unixTime()}`.catch(() => {});
}
