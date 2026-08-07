import { api } from "../../core/pub/js/qino.js";

cms.initNode("backend.superuser.versions", (el) => {
  const nid = cms.el.nid(el);
  const alert = async (t) => (await import("@qino/u2/js/dialog/dialog.js")).alert(t);

  el.addEventListener("click", async (e) => {
    const thin = e.target.closest("button.-thin");
    const delSpace = e.target.closest("button.-del-space");
    const purge = e.target.closest("button.-purge");

    if (thin) {
      thin.disabled = true;
      const res = await api.cms.node(nid).api.post({ thin: 1 });
      await alert((res?.deleted ?? 0) + " entries deleted");
      location.reload();
    } else if (delSpace) {
      await api.cms.node(nid).api.post({ deleteSpace: delSpace.dataset.space });
      location.reload();
    } else if (purge) {
      await api.cms.node(nid).api.post({ purge: 1 });
      location.reload();
    }
  });
});
