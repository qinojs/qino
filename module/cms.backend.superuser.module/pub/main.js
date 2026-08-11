import { t } from "@qino/pub/qino.js";

cms.initNode("backend.superuser.module", (el) => {
  const nid = Number(cms.el.nid(el));

  // client-side filter — all modules are already rendered, no round-trip needed
  const search = el.querySelector("[data-module-search]");
  search?.addEventListener("input", () => {
    const q = search.value.toLowerCase();
    // inline display beats u2-table's `display:table-row`, which would override [hidden]
    for (const tr of el.querySelectorAll("tbody tr")) tr.style.display = tr.textContent.toLowerCase().includes(q) ? "" : "none";
  });

  el.addEventListener("click", async (e) => {
    // an empty file, so the editor link beside it has something to open
    const add = e.target.closest("[data-new-file]");
    if (add) {
      const rel = await (await import("@qino/u2/js/dialog/dialog.js")).prompt(await t`Path inside the module`, "");
      if (rel) cms.reloadNode(nid, { newFile: rel, mod: add.dataset.newFile });
      return;
    }
    // runtime enable/disable → reload the node so the fresh linked-state renders
    const btn = e.target.closest("[data-mod-toggle]");
    if (!btn) return;
    btn.disabled = true;
    cms.reloadNode(nid, { [btn.dataset.modToggle]: btn.dataset.mod, mod: btn.dataset.mod });
  });
});
