import { api } from "@qino/pub/api.js";

cms.initNode("backend.cms.tree.urls", (el) => {
  const reload = (vars = {}) => cms.reloadPart(cms.el.nid(el), "list", vars);

  el.querySelector(".cmsBeTree")?.addEventListener("click", async (e) => {
    const toggle = e.target.closest("[data-toggle-id]");
    if (!toggle) return;
    e.preventDefault();
    await reload({ toggleOpen: toggle.dataset.toggleId, value: toggle.dataset.toggleValue });
  });

  el.addEventListener("change", async (e) => {
    if (e.target.matches("[data-toggle-contents]")) {
      await reload({ showContents: e.target.checked ? "1" : "0" });
      return;
    }
    const cell = e.target.closest("[data-pid]");
    if (!cell) return;
    cell.inert = true;
    const ref = api.cms.node(cell.dataset.pid).urls(cell.dataset.lang);
    try {
      if (e.target.name === "auto" && e.target.checked) await ref.custom.delete();
      else await ref.put({ url: cell.querySelector("[name=url]").value });
      await reload();
    } catch (error) {
      if (e.target.name === "auto") e.target.checked = !e.target.checked;
      cell.querySelector("output").textContent = error.message;
    } finally {
      cell.inert = false;
    }
  });
});
