import { api } from "@qino/pub/api.js";
import { t } from "@qino/pub/t.js";

cms.initNode("cont.my.clients", async (el) => {
  const node = api.cms.node(Number(cms.el.nid(el)));
  const labels = {
    other: await t`Log out this device?`,
    self: await t`Log out here?`,
    error: await t`Could not log out this device.`,
  };

  el.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-logout]");
    if (!btn) return;
    const self = btn.hasAttribute("data-self");
    if (!confirm(self ? labels.self : labels.other)) return;
    btn.disabled = true;
    if (self) { // the own device logs itself out the normal way
      await api.core.logout.post();
      location.reload();
      return;
    }
    const res = await node.api.post({ logout_client: btn.dataset.logout });
    if (res?.ok) return void btn.closest("tr")?.remove();
    btn.disabled = false;
    alert(res?.message || labels.error);
  });
});
