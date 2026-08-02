/**
 * web_push.js — Web Push client
 *
 * import { subscribe, unsubscribe, channels } from "/m/messaging.web_push/pub/web_push.js";
 */

import { apt } from "../../core/pub/js/qino.js";

const api = apt["messaging.web_push"];

const registration = () => navigator.serviceWorker?.ready;

/**
 * Ask for permission and register this browser for `channels` — the list replaces
 * whatever this browser was subscribed to before. False when the user declined.
 */
export async function subscribe(channels = []) {
  const reg = await registration();
  if (!reg) return false;
  if (await Notification.requestPermission() !== "granted") return false;
  const { publicKey } = await api.key.get();
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
  const { endpoint, keys } = sub.toJSON();
  await api.subscription.post({ endpoint, ...keys, channels });
  return true;
}

/** Drop this browser's subscription, in the browser and on the server. */
export async function unsubscribe() {
  const sub = await (await registration())?.pushManager.getSubscription();
  if (!sub) return;
  await api.subscription.delete({ endpoint: sub.endpoint });
  await sub.unsubscribe();
}

/** The channels this browser is subscribed to — empty when it has no subscription. */
export async function channels() {
  const sub = await (await registration())?.pushManager.getSubscription();
  if (!sub) return [];
  return (await api.subscription.get({ endpoint: sub.endpoint })).channels;
}
