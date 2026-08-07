import { api } from "../../core/pub/js/qino.js";

cms.initNode("backend.superuser.locale.currency", (el) => {
  const nid = Number(cms.el.nid(el));
  const node = api.cms.node(nid);

  el.addEventListener("change", (e) => {
    const every = e.target.closest("select.-every");
    // Switching the frequency turns the rates editable or read-only.
    if (every) return node.api.post({ every: every.value }).then(() => cms.reloadNode(nid));

    const rate = e.target.closest("input.-rate");
    if (rate) node.api.post({ rate: rate.closest("[itemid]").getAttribute("itemid"), value: rate.value });
  });

  // Every currency there is, so the one you mean is found by code, name or symbol. Delegated, so
  // it survives a reload of the node.
  el.addEventListener("input", (e) => {
    const search = e.target.closest(".-search");
    if (!search) return;
    const term = search.value.trim().toLowerCase();
    for (const tr of el.querySelectorAll("tbody tr")) {
      tr.style.display = !term || tr.textContent.toLowerCase().includes(term) ? "" : "none";
    }
  });

  el.addEventListener("click", async (e) => {
    const button = e.target.closest("button.-now");
    if (!button) return;
    button.disabled = true;
    const res = await node.api.post({ now: 1 }).catch(() => null);
    button.disabled = false;
    if (res?.error) {
      const { alert } = await import("@qino/u2/js/dialog/dialog.js");
      await alert(res.error);
      return;
    }
    cms.reloadNode(nid);
  });
});
