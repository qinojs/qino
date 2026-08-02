// Public API of messaging.web_push. The qino plugin lives in ./plugin.ts.

import { generateVAPIDKeys, sendNotification } from "web-push-neo";
import { $item, sql, type App } from "../core/mod.ts";

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

  const rows = await app.db.query`SELECT * FROM web_push_subscription ${where}`;
  if (!rows.length) return 0;

  const options = { vapidDetails: await vapid(app) };
  const payload = JSON.stringify(msg);
  let sent = 0;
  await Promise.all(rows.map(async (row) => {
    try {
      await sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, payload, options);
      sent++;
    } catch (e) {
      // 404/410 = the browser dropped the subscription for good; everything else is transient
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await app.db.table("web_push_subscription").delete(row.id);
    }
  }));
  return sent;
}

/** The channels a visitor can subscribe to, as defined in the backend. */
export async function channels(app: App): Promise<string[]> {
  const rows = await app.db.query`SELECT name FROM web_push_channel ORDER BY name`;
  return rows.map((r) => String(r.name));
}

/** The app's VAPID details — the key pair is generated and stored in settings on first use. */
export async function vapid(app: App): Promise<{ subject: string; publicKey: string; privateKey: string }> {
  const subject = String(await app.settings["messaging.web_push"].subject ?? "") || "mailto:admin@localhost";
  return { subject, ...await keyPair(app) };
}

// One in-flight generation per app — parallel requests must not create two key pairs.
const keys = new WeakMap<App, Promise<{ publicKey: string; privateKey: string }>>();

function keyPair(app: App): Promise<{ publicKey: string; privateKey: string }> {
  let pending = keys.get(app);
  if (!pending) keys.set(app, pending = loadKeys(app).catch((e) => { keys.delete(app); throw e; }));
  return pending;
}

async function loadKeys(app: App) {
  const settings = app.settings["messaging.web_push"];
  const publicKey = String(await settings.publicKey ?? "");
  const privateKey = String(await settings.privateKey ?? "");
  if (publicKey && privateKey) return { publicKey, privateKey };

  const fresh = await generateVAPIDKeys();
  // writing goes through the raw item — on the proxy, .set would read as a child key
  const node = app.settings[$item].sub(["messaging.web_push"]);
  await Promise.all([node.item("publicKey").set(fresh.publicKey), node.item("privateKey").set(fresh.privateKey)]);
  return fresh;
}
