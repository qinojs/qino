import { apt } from "../../core/pub/js/qino.js";

cms.initNode("backend.cms.module.access", (el) => {
  const nid = Number(cms.el.nid(el));
  el.addEventListener("click", async (e) => {
    const cell = e.target.closest(".cmsModuleAccess td[data-module][data-grp]");
    if (!cell) return;

    const cur = cell.getAttribute("v");
    const next = cur === "" ? "0" : cur === "0" ? "1" : cur === "1" ? "2" : cur === "2" ? "3" : "";
    await apt.cms.node(nid).html.post({ vars: {
      set_access: 1,
      module: cell.dataset.module,
      grp: cell.dataset.grp,
      access: next,
    } });
    cell.setAttribute("v", next);
    cell.textContent = next || "-";
  });
});
