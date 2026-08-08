import { api } from "../../core/pub/js/qino.js";

cms.initNode("backend.superuser.messaging", (el) => {
  const node = api.cms.node(Number(cms.el.nid(el)));
  const scroll = el.querySelector(".-scroll");
  if (scroll) scroll.scrollTop = scroll.scrollHeight;
  let busy = false;

  el.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-reply]");
    if (!button || busy) return;
    const form = button.closest("form");
    if (!form.reportValidity()) return;
    busy = true;
    button.disabled = true;
    try {
      const response = await node.api.post({
        reply: {
          usr: form.elements.usr.value,
          channel: form.elements.channel.value,
          text: form.elements.text.value.trim(),
        },
      });
      await (await import("@qino/u2/js/dialog/dialog.js")).alert(response?.message || "");
      if (response?.ok) location.reload();
    } catch (e) {
      await (await import("@qino/u2/js/dialog/dialog.js")).alert(e?.message || String(e));
    } finally {
      busy = false;
      button.disabled = false;
    }
  });
});
