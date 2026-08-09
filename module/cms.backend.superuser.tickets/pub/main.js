import { api } from "../../core/pub/js/qino.js";

cms.initNode("backend.superuser.tickets", (el) => {
  const node = api.cms.node(Number(cms.el.nid(el)));
  let busy = false;

  const execute = async (button, data) => {
    if (busy) return;
    busy = true;
    button.disabled = true;
    const dialog = await import("@qino/u2/js/dialog/dialog.js");
    try {
      const response = await node.api.post(data);
      location.reload();
      await dialog.alert(response?.message || "");
    } catch (e) {
      await dialog.alert(e?.message || String(e));
    } finally {
      busy = false;
      button.disabled = false;
    }
  };

  el.addEventListener("click", (event) => {
    const revoke = event.target.closest("[data-revoke]");
    const purge = event.target.closest("[data-purge]");
    if (revoke) execute(revoke, { revoke: revoke.dataset.revoke });
    else if (purge) execute(purge, { purge: true });
  });
});
