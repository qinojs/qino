cms.initNode("backend.superuser.stores", (el) => {
  const nid = Number(cms.el.nid(el));

  el.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const { act, mod = "", store = "" } = btn.dataset;
    if (act === "addStore") {
      const { prompt } = await import("@qino/u2/js/dialog/dialog.js");
      const url = await prompt("Catalog URL of the store (store.json)", "");
      if (!url) return;
      btn.disabled = true;
      cms.reloadNode(nid, { act, store: url });
      return;
    }
    btn.disabled = true;
    cms.reloadNode(nid, { act, mod, store });
  });
});
