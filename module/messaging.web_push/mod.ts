// Public API of messaging.web_push. The qino plugin lives in ./plugin.ts.

import { sendNotification } from "web-push-neo";
import { sql, type App, type Row } from "../core/mod.ts";
import { vapid } from "./lib/vapid.ts";

/**
 * Deliver a notification to a channel, a group, a user, a client, one subscription, or
 * everyone. Channels are per browser, groups per user — the two answer different
 * questions and can be used side by side.
 *
 * Resolves with the number of browsers reached; subscriptions the push service has
 * dropped are removed on the way. Everything in `msg` but `url` reaches
 * showNotification() as is.
 */
export async function push(
  app: App,
  to: { channel?: string; grp?: number; usr?: number; client?: string | number; sub?: number; all?: true },
  msg: { title: string; body?: string; url?: string },
): Promise<number> {
  const where = to.channel != null ? sql`WHERE id IN (
      SELECT sc.sub_id FROM web_push_subscription_channel sc
      JOIN web_push_channel c ON c.id = sc.channel_id WHERE c.name = ${to.channel})`
    : to.grp != null ? sql`WHERE usr_id IN (SELECT usr_id FROM usr_grp WHERE grp_id = ${to.grp})`
    : to.usr != null ? sql`WHERE usr_id = ${to.usr}`
    : to.client != null ? sql`WHERE client_id = ${to.client}`
    : to.sub != null ? sql`WHERE id = ${to.sub}`
    : to.all ? sql``
    : null;
  if (!where) throw new Error("push needs a recipient: { channel }, { grp }, { usr }, { client }, { sub } or { all: true }");

  const rows = await app.db.query`SELECT id, endpoint, p256dh, auth FROM web_push_subscription ${where}`;
  if (!rows.length) return 0;

  const options = { vapidDetails: await vapid(app) };
  const payload = JSON.stringify(msg);
  const gone: number[] = [];
  let sent = 0;
  await Promise.all(rows.map(async (row) => {
    try {
      await sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, payload, options);
      sent++;
    } catch (e) {
      // 404/410 = the browser dropped the subscription for good; everything else is transient
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) gone.push(Number(row.id));
      else console.warn(`web_push: subscription ${row.id} rejected with ${status ?? "no status"}:`, (e as Error).message);
    }
  }));
  if (gone.length) await app.db.exec`DELETE FROM web_push_subscription WHERE id IN (${sql.join(gone.map((id) => sql`${id}`))})`;
  return sent;
}

/** The key a browser needs for pushManager.subscribe(), plus the contact behind it. */
export async function publicKey(app: App): Promise<{ subject: string; publicKey: string }> {
  const { subject, publicKey } = await vapid(app);
  return { subject, publicKey };
}

/** The channels a visitor can subscribe to, with how many browsers each reaches. */
export function channels(app: App): Promise<Row[]> {
  return app.db.query`
    SELECT c.id, c.name, (SELECT COUNT(*) FROM web_push_subscription_channel sc WHERE sc.channel_id = c.id) AS subs
    FROM web_push_channel c
    ORDER BY c.name`;
}

/** Create a channel — undefined when the name is already taken. */
export async function addChannel(app: App, name: string): Promise<number | undefined> {
  if (await app.db.one`SELECT id FROM web_push_channel WHERE name = ${name}`) return;
  return Number(await app.db.table("web_push_channel").insert({ name }));
}

/** Remove a channel and every subscription to it. */
export async function removeChannel(app: App, id: number): Promise<void> {
  await app.db.table("web_push_channel").delete(id);
}

/** Every stored subscription with its user's e-mail and the channels it holds. */
export async function subscriptions(app: App, limit = 500): Promise<Row[]> {
  const [rows, memberships] = await Promise.all([
    app.db.query`
      SELECT s.*, u.email
      FROM web_push_subscription s
      LEFT JOIN usr u ON u.id = s.usr_id
      ORDER BY s.created DESC LIMIT ${limit}`,
    app.db.query`
      SELECT sc.sub_id, c.name FROM web_push_subscription_channel sc
      JOIN web_push_channel c ON c.id = sc.channel_id
      ORDER BY c.name`,
  ]);
  // grouped here rather than in SQL — GROUP_CONCAT/STRING_AGG differ per dialect
  const byId = new Map<number, string[]>();
  for (const m of memberships) {
    const id = Number(m.sub_id);
    const list = byId.get(id);
    list ? list.push(String(m.name)) : byId.set(id, [String(m.name)]);
  }
  return rows.map((row) => ({ ...row, channels: byId.get(Number(row.id)) ?? [] }));
}

/** Forget one browser's subscription. */
export async function removeSubscription(app: App, id: number): Promise<void> {
  await app.db.table("web_push_subscription").delete(id);
}
