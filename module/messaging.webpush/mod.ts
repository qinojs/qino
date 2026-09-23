import { sendNotification } from "web-push-neo";
import { sql } from "@qino/qino";
import { ChannelError, delivered, send as dispatch, selectors, titled } from "@qino/qino/messaging";

import { vapid } from "./lib/vapid.ts";

import type { App, Row } from "@qino/qino";
import type { Channel, Msg, Recipient, Rendering, To } from "@qino/qino/messaging";

/** A one-time code must not go to the asking device, so it is skipped. */
const notClient = (id: string | number | undefined) => id == null ? sql`` : sql`AND s.client_id <> ${Number(id)}`;

/** Notification API fields (`url`, `icon`, `tag`, `actions`) go to showNotification() as is and are
 *  recorded, so a resend is identical. */
type PushMsg = Msg & { url?: string } & Record<string, unknown>;

/** What showNotification() gets besides title and body. */
const pushOptions = (
  { text: _text, title: _title, format: _format, template: _template, attachments: _attachments, ...options }: PushMsg,
) => options;

/** Our side, not the endpoint's: no answer, rate limit, or push service problems. */
const ours = (status: number | undefined) => !status || status === 429 || status >= 500;

/** What web-push-neo says went wrong, short enough for the journal and the subscription. */
const failure = (e: unknown) => `${(e as { statusCode?: number }).statusCode ?? "no status"}: ${(e as Error).message}`.slice(0, 255);

/** Resolve `to` to subscriptions. Channels are per browser, groups per user. The journal stores the
 *  endpoint's hash. */
async function recipients(
  app: App,
  to: To & { channel?: string; client?: string | number | (string | number)[]; sub?: number | number[] },
): Promise<Recipient[]> {
  const clients = [to.client ?? []].flat().map(Number);
  const subs = [to.sub ?? []].flat();
  const who = [
    ...selectors(to, "s.usr_id"),
    to.channel != null ? sql`s.id IN (
      SELECT sc.sub_id FROM webpush_subscription_channel sc
      JOIN webpush_channel c ON c.id = sc.channel_id WHERE c.name = ${to.channel})` : null,
    clients.length ? sql.in("s.client_id", clients) : null,
    subs.length ? sql.in("s.id", subs) : null,
  ].flatMap((term) => term ?? []);
  if (!who.length) throw new Error("send needs a recipient: { channel }, { grp }, { usr }, { client }, { sub } or { all: true }");
  const rows = await app.db.query`SELECT s.usr_id, s.endpoint_hash FROM webpush_subscription s
    WHERE (${sql.join(who, " OR ")}) ${notClient(to.notClient)}`;
  return rows.map((row) => ({ ...row, address: String(row.endpoint_hash), usrId: Number(row.usr_id) || undefined }));
}

/**
 * Notify channels, groups, users, clients, subscriptions, or everyone.
 *
 * Resolves with the number of browsers reached. Title: given, else the first line. No markup, so
 * formatted text becomes plain.
 */
export const send = (
  app: App,
  to: To & { channel?: string; client?: string | number | (string | number)[]; sub?: number | number[] },
  message: string | PushMsg,
): Promise<number> => dispatch(app, messagingChannel, to, titled(message));

/** Send a batch. Subscriptions the push service dropped are removed. */
async function deliver(app: App, rows: Row[], msg: Msg, { render }: Rendering): Promise<number> {
  const table = app.db.table("webpush_subscription");
  const options = pushOptions(msg as PushMsg);
  const [subs, vapidDetails] = await Promise.all([
    app.db.query`SELECT * FROM webpush_subscription
      WHERE ${sql.in("endpoint_hash", rows.map((row) => String(row.address)))}`,
    vapid(app),
  ]);
  const known = new Map(subs.map((sub) => [String(sub.endpoint_hash), sub]));
  const gone: number[] = [];
  let sent = 0;
  await Promise.all(rows.map(async (row) => {
    const sub = known.get(String(row.address));
    // the browser unsubscribed while the message waited; nothing to try again
    if (!sub) return void await delivered(app, Number(row.id), new Error("subscription is gone"));
    try {
      const body = (await render(row)).text;
      const payload = JSON.stringify({ title: msg.title, ...options, body });
      await sendNotification({ endpoint: String(sub.endpoint), keys: { p256dh: String(sub.p256dh), auth: String(sub.auth) } }, payload, { vapidDetails });
      await delivered(app, Number(row.id));
      sent++;
      if (sub.error) await table.update(sub.id, { error: null }); // it delivers again
    } catch (e) {
      // 404/410 = subscription gone for good; other errors are left for the admin
      const status = (e as { statusCode?: number }).statusCode;
      const error = failure(e);
      if (ours(status)) return void await delivered(app, Number(row.id), new ChannelError(error)); // the endpoint is not to blame
      await delivered(app, Number(row.id), error);
      if (status === 404 || status === 410) return void gone.push(Number(sub.id));
      console.warn(`webpush: subscription ${sub.id} rejected —`, error);
      await table.update(sub.id, { error });
    }
  }));
  if (gone.length) await app.db.exec`DELETE FROM webpush_subscription WHERE ${sql.in("id", gone)}`;
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
      SELECT s.*, u.username
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

/** The channel this module is. */
export const messagingChannel: Channel = {
  name: "webpush",
  label: "Web Push",
  color: "--purple",
  reach: async (app: App, usrId: number, notClient?: string | number) =>
    Number(await app.db.one`SELECT COUNT(*) FROM webpush_subscription WHERE usr_id = ${usrId}
      ${notClient == null ? sql`` : sql`AND client_id <> ${Number(notClient)}`}`),
  recipients,
  send,
  deliver,
};
