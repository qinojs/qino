import { api, t } from "@qino/pub/qino.js";

cms.initNode("cont.my.clients", async (el) => {
  const node = api.cms.node(Number(cms.el.nid(el)));
  const buttons = [...el.querySelectorAll("[data-logout]")];
  if (!buttons.length) return;

  const confirmText = await t`Log out this device?`;
  for (const btn of buttons) {
    btn.addEventListener("click", async () => {
      if (!confirm(confirmText)) return;
      const clientId = btn.dataset.client;
      const res = await node.api.post({ logout_client: clientId });
      if (res?.ok) {
        btn.closest("tr")?.remove();
      } else {
        alert(res?.message || "Could not log out this device.");
      }
    });
  }
});
