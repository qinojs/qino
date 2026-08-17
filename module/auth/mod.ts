// Public API of auth. The qino plugin lives in ./plugin.ts.
import { login, sql, unixTime } from "@qino/qino";

import type { App, Ctx, Row } from "@qino/qino";

/** A way of showing who you are, declared by a module as `export const authFactors`.
 *  Starting a session and refreshing one are different permissions — a factor may have either. */
export type Factor = {
  name: string;
  label: string;
  login?: boolean;
  stepUp?: boolean;
  /** Where it sits among the offered ones, lowest first — the strongest way in should be the one a
   *  dialog opens. Presentation only: what a factor is worth is not a number. */
  order?: number;
  /** Whether this user has it set up. A factor that cannot know per user leaves it out and is then
   *  offered as a way in, but never counted as something they have. */
  has?(app: App, usrId: number): Promise<boolean>;
};

/** What a module exports: its factors, or a function of the app for a module whose factors depend
 *  on what else is installed — `auth.otp` has one per messaging channel. */
type Declaration = Factor[] | ((app: App) => Factor[]);

/** Every factor a linked module declares. */
export function factors(app: App): Factor[] {
  return app.modules.linked().flatMap((mod) => {
    const declared = mod.plugin.authFactors as Declaration | undefined;
    return typeof declared === "function" ? declared(app) : declared ?? [];
  });
}

/** The factors one user has set up, narrowed to those allowed to `login` or to `stepUp`. */
export async function userFactors(app: App, usrId: number, use?: "login" | "stepUp"): Promise<Factor[]> {
  const all = use ? factors(app).filter((f) => f[use]) : factors(app);
  const has = await Promise.all(all.map((f) => f.has?.(app, usrId).catch(() => false) ?? true));
  return all.filter((_, i) => has[i]);
}

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

/** A factor established that this is user `usrId`; where the request stands decides what that is
 *  worth. Signed in as them it is a fresh proof kept in the session, otherwise it is a login. */
export async function proof(ctx: Ctx, factor: string, usrId: number): Promise<boolean> {
  const declared = factors(ctx.app).find((f) => f.name === factor);
  if (!declared) throw new Error(`auth: no factor "${factor}" — declare it in a module's authFactors export`);
  if (ctx.userId === usrId) {
    // A stateless credential identifies a request, not a session — the session a proof would be
    // written to is whoever's holds the cookie, so there is nothing here to refresh.
    if (ctx.statelessAuth || !declared.stepUp) return false;
    ctx.sess.data.core.via[factor](unixTime()); // the same place `via()` reads, one screen up
    return true;
  }
  return declared.login ? await login(ctx, usrId, factor) : false;
}
