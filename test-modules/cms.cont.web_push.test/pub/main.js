import { subscribe, unsubscribe, channels } from "../../messaging.web_push/pub/web_push.js";
import { t } from "../../core/pub/js/qino.js";

cms.initNode("cont.web_push.test", async (el) => {
  const boxes = [...el.querySelectorAll("[name=channel]")];
  const msg = el.querySelector("[name=msg]");

  if (!("Notification" in globalThis) || !navigator.serviceWorker) {
    msg.value = await t`This browser cannot receive push notifications.`;
    return;
  }

  const active = await channels();
  for (const box of boxes) {
    box.checked = active.includes(box.value);
    box.disabled = false;
  }
  msg.value = active.length ? await t`Subscribed.` : await t`Not subscribed.`;

  el.addEventListener("change", async () => {
    const wanted = boxes.filter((b) => b.checked).map((b) => b.value);
    for (const box of boxes) box.disabled = true;
    try {
      // an empty list means the browser wants nothing at all, not an empty subscription
      const ok = wanted.length ? await subscribe(wanted) : (await unsubscribe(), true);
      if (!ok) {
        for (const box of boxes) box.checked = false;
        msg.value = await t`Permission denied.`;
      } else {
        msg.value = wanted.length ? await t`Subscribed to ${wanted.join(", ")}.` : await t`Not subscribed.`;
      }
    } catch (e) {
      msg.value = e.message;
    } finally {
      for (const box of boxes) box.disabled = false;
    }
  });
});
