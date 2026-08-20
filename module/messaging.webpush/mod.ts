// Public API of messaging.webpush. The qino plugin lives in ./plugin.ts.
import { sendNotification } from "web-push-neo";
import { sql, unixTime } from "@qino/qino";
import { msgOf, record, titleOf } from "@qino/qino/messaging";

import { vapid } from "./lib/vapid.ts";

import type { App, Row } from "@qino/qino";
import type { Msg } from "@qino/qino/messaging";

/**
 * Deliver a notification to a channel, a group, a user, a client, one subscription, or
 * everyone. Channels are per browser, groups per user — the two answer different
 * questions and can be used side by side.
 *
 * Resolves with the number of browsers reached; subscriptions the push service has
 * dropped are removed on the way. A notification needs a title, so an absent one is the
 * first line of the text. Everything besides `text` and `url` reaches showNotification()
 * as is — `icon`, `image`, `tag`, `actions`, `requireInteraction` and friends.
 */
/** A one-time code proves presence only where the request is not — so the asking device is skipped. */
const notClient = (id: string | number | undefined) => id == null ? sql`` : sql`AND client_id <> ${Number(id)}`;

export async function send(
  app: App,
  to: { grp?: number; usr?: number; all?: true; channel?: string; client?: string | number; sub?: number; notClient?: string | number },
  message: string | Msg & { url?: string } & Record<string, unknown>,
): Promise<number> {
  const given = msgOf(message);
  const msg = { ...given, title: titleOf(given) }; // journal what was really sent, derived title included
  const who = to.channel != null ? sql`id IN (
      SELECT sc.sub_id FROM webpush_subscription_channel sc
      JOIN webpush_channel c ON c.id = sc.channel_id WHERE c.name = ${to.channel})`
    : to.grp != null ? sql`usr_id IN (SELECT usr_id FROM usr_grp WHERE grp_id = ${to.grp})`
    : to.usr != null ? sql`usr_id = ${to.usr}`
    : to.client != null ? sql`client_id = ${Number(to.client)}`
    : to.sub != null ? sql`id = ${to.sub}`
    : to.all ? sql`${true}`
    : null;
  if (!who) throw new Error("send needs a recipient: { channel }, { grp }, { usr }, { client }, { sub } or { all: true }");
  const where = sql`WHERE ${who} ${notClient(to.notClient)}`;
  const time = unixTime();

  const rows = await app.db.query`SELECT id, usr_id, endpoint, p256dh, auth, error FROM webpush_subscription ${where}`;

  const table = app.db.table("webpush_subscription");
  const options = { vapidDetails: await vapid(app) };
  const { text, ...notification } = msg; // the service worker calls showNotification(title, rest)
  const payload = JSON.stringify({ ...notification, body: text });
  const gone: number[] = [];
  const outcomes = new Map<string, { usrId?: number; sent: boolean; errors: string[] }>();
  let sent = 0;
  await Promise.all(rows.map(async (row) => {
    const usrId = row.usr_id == null ? undefined : Number(row.usr_id);
    const key = usrId == null ? `sub:${row.id}` : `usr:${usrId}`;
    const outcome = outcomes.getOrInsertComputed(key, () => ({ usrId, sent: false, errors: [] }));
    try {
      await sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, payload, options);
      sent++;
      outcome.sent = true;
      if (row.error) await table.update(row.id, { error: null }); // it delivers again
    } catch (e) {
      // 404/410 = the browser dropped the subscription for good; anything else stays for the admin to judge
      const status = (e as { statusCode?: number }).statusCode;
      const error = `${status ?? "no status"}: ${(e as Error).message}`.slice(0, 255);
      outcome.errors.push(error);
      if (status === 404 || status === 410) return gone.push(Number(row.id));
      console.warn(`webpush: subscription ${row.id} rejected —`, error);
      await table.update(row.id, { error });
    }
  }));
  if (gone.length) await app.db.exec`DELETE FROM webpush_subscription WHERE id IN (${sql.join(gone.map((id) => sql`${id}`))})`;
  await record(app, { channel: "webpush", direction: "out", grpId: to.grp, msg, data: { to }, time },
    Array.from(outcomes.values(), (outcome) => ({
      usrId: outcome.usrId,
      error: outcome.sent ? undefined : outcome.errors.join("; "),
      time: unixTime(),
    })));
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
    SELECT c.id, c.name, (SELECT COUNT(*) FROM webpush_subscription_channel sc WHERE sc.channel_id = c.id) AS subs
    FROM webpush_channel c
    ORDER BY c.name`;
}

/** Create a channel — undefined when the name is already taken. */
export async function addChannel(app: App, name: string): Promise<number | undefined> {
  if (await app.db.one`SELECT id FROM webpush_channel WHERE name = ${name}`) return;
  return Number(await app.db.table("webpush_channel").insert({ name }));
}

/** Remove a channel and every subscription to it. */
export async function removeChannel(app: App, id: number): Promise<void> {
  await app.db.table("webpush_channel").delete(id);
}

/** Every stored subscription with its user's e-mail and the channels it holds. */
export async function subscriptions(app: App, limit = 500): Promise<Row[]> {
  const [rows, memberships] = await Promise.all([
    app.db.query`
      SELECT s.*, u.email
      FROM webpush_subscription s
      LEFT JOIN usr u ON u.id = s.usr_id
      ORDER BY s.created DESC LIMIT ${limit}`,
    app.db.query`
      SELECT sc.sub_id, c.name FROM webpush_subscription_channel sc
      JOIN webpush_channel c ON c.id = sc.channel_id
      ORDER BY c.name`,
  ]);
  // grouped here rather than in SQL — GROUP_CONCAT/STRING_AGG differ per dialect
  const byId = new Map<number, string[]>();
  for (const m of memberships) byId.getOrInsertComputed(Number(m.sub_id), () => []).push(String(m.name));
  return rows.map((row) => ({ ...row, channels: byId.get(Number(row.id)) ?? [] }));
}

/** Forget one browser's subscription. */
export async function removeSubscription(app: App, id: number): Promise<void> {
  await app.db.table("webpush_subscription").delete(id);
}
