import { subscribe, unsubscribe, channels } from "@qino/m/messaging.webpush/pub/webpush.js";
import { t } from "@qino/pub/t.js";

cms.initNode("cont.webpush.test", async (el) => {
  const boxes = [...el.querySelectorAll("[name=channel]")];
  const msg = el.querySelector("[name=msg]");

  if (!("Notification" in globalThis) || !navigator.serviceWorker) {
    msg.value = await t`This browser cannot receive push notifications.`;
    return;
  }

  const enable = (on) => boxes.forEach((b) => b.disabled = !on);

  const active = await channels();
  for (const box of boxes) box.checked = active.includes(box.value);
  enable(true);
  msg.value = active.length ? await t`Subscribed.` : await t`Not subscribed.`;

  el.addEventListener("change", async () => {
    const wanted = boxes.filter((b) => b.checked).map((b) => b.value);
    enable(false);
    try {
      // an empty list means the browser wants nothing at all, not an empty subscription
      const ok = wanted.length ? await subscribe(wanted) : (await unsubscribe(), true);
      if (!ok) {
        boxes.forEach((b) => b.checked = false);
        msg.value = await t`Permission denied.`;
      } else {
        msg.value = wanted.length ? await t`Subscribed to ${wanted.join(", ")}.` : await t`Not subscribed.`;
      }
    } catch (e) {
      msg.value = e.message;
    } finally {
      enable(true);
    }
  });
});
