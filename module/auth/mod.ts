// Public API of auth. The qino plugin lives in ./plugin.ts.
import { authFactors, loginProof, sql, unixTime } from "@qino/qino";

import type { App, Ctx, Offer, Row } from "@qino/qino";

/** A way of proving who you are. Core owns the shape because core reads it. */
export type { AuthFactor as Factor } from "@qino/qino";

/** Every factor a linked module declares, and those one user has set up. */
export { authFactors as factors, userFactors } from "@qino/qino";

// ─── The secrets of factors too small for a table of their own ────────────────

/** The rows of one factor kind. `data` is the factor's own JSON; nothing here looks inside it. */
export function stored(app: App, usrId: number, type: string): Promise<Row[]> {
  return app.db.query`SELECT * FROM usr_auth_factor WHERE usr_id = ${usrId} AND type = ${type} ORDER BY created`;
}

/** Keep one secret; several rows of one type are one factor with several secrets. */
export async function store(app: App, usrId: number, type: string, data: unknown, label = ""): Promise<void> {
  await app.db.table("usr_auth_factor").insert({
    usr_id: usrId,
    type,
    label,
    data: JSON.stringify(data),
    created: unixTime(),
  });
}

/** Remove secrets again — a whole kind, or one row of it. Always keyed by the user, so a foreign
 *  id removes nothing and no caller has to check ownership itself. Resolves with the rows gone. */
export async function drop(app: App, usrId: number, type: string, id?: number): Promise<number> {
  const one = id == null ? sql`` : sql`AND id = ${id}`;
  const res = await app.db.exec`DELETE FROM usr_auth_factor WHERE usr_id = ${usrId} AND type = ${type} ${one}`;
  return Number(res?.affectedRows ?? 0);
}

// ─── What a session was shown ─────────────────────────────────────────────────

/**
 * How a session came by its identity: what core wrote at login, plus what a step-up added since.
 * Pass the running request, or the stored document of some other session to read it from outside.
 */
export function via(from: Ctx | string): Record<string, number> {
  if (typeof from !== "string") return (from.sess.data.core.via() ?? {}) as Record<string, number>;
  try {
    return JSON.parse(from)?.core?.via ?? {};
  } catch {
    return {}; // a session document we cannot read simply has no record
  }
}

/**
 * A factor established that this is user `usrId`. Signed in as them it is a step-up (a fresh proof in
 * the session), otherwise a login.
 *
 * Nothing = done. Otherwise what is still missing; empty = nothing here helps (inactive user, or a
 * factor that may not do this).
 */
export async function proof(ctx: Ctx, factor: string, usrId: number): Promise<Offer[] | undefined> {
  const declared = authFactors(ctx.app).find((f) => f.name === factor);
  if (!declared) throw new Error(`auth: no factor "${factor}" — declare it in a module's authFactors export`);
  if (ctx.userId !== usrId) return await loginProof(ctx, declared, usrId);
  // stateless credentials identify a request, not the session the proof would be written to
  if (ctx.statelessAuth || !declared.stepUp) return [];
  ctx.sess.data.core.via[factor](unixTime()); // the same place `via()` reads, one screen up
}
