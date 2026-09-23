import type { App, Row } from "@qino/qino";

/** Providers to offer users — only fully configured ones (client_id set). */
export const providers = (app: App): Promise<{ name: string }[]> =>
  app.db.query`SELECT name FROM oauth_provider WHERE client_id <> '' ORDER BY name`;

/** The providers one user signs in through. */
export const links = (app: App, usrId: number): Promise<Row[]> =>
  app.db.query`SELECT provider, sub, created, last_used FROM oauth_provider_usr WHERE usr_id = ${usrId} ORDER BY created`;

/** Remove a link. Keyed by user, so others' links are untouched. Resolves with the deleted count. */
export async function unlink(app: App, usrId: number, provider: string, sub: string): Promise<number> {
  const res = await app.db.exec`DELETE FROM oauth_provider_usr WHERE usr_id = ${usrId} AND provider = ${provider} AND sub = ${sub}`;
  return Number(res?.affectedRows ?? 0);
}
