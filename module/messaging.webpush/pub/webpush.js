/**
 * webpush.js — Web Push client
 *
 * import { subscribe, unsubscribe, channels } from "/m/messaging.webpush/pub/webpush.js";
 */
import { api } from "@qino/pub/api.js";

const push = api["messaging.webpush"];

const current = async () => (await navigator.serviceWorker?.ready)?.pushManager.getSubscription();

/**
 * Ask for permission and register this browser for `channels` — the list replaces
 * whatever this browser was subscribed to before. False when the user declined.
 */
export async function subscribe(channels = []) {
  const reg = await navigator.serviceWorker?.ready;
  if (!reg) return false;
  if (await Notification.requestPermission() !== "granted") return false;
  const { publicKey } = await push.key.get();
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
  const { endpoint, keys } = sub.toJSON();
  await push.subscription.post({ endpoint, ...keys, channels });
  return true;
}

/** Drop this browser's subscription, in the browser and on the server. */
export async function unsubscribe() {
  const sub = await current();
  if (!sub) return;
  await push.subscription.delete({ endpoint: sub.endpoint });
  await sub.unsubscribe();
}

/** The channels this browser is subscribed to — empty when it has no subscription. */
export async function channels() {
  const sub = await current();
  if (!sub) return [];
  return (await push.subscription.get({ endpoint: sub.endpoint })).channels;
}
