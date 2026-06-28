import { apt } from "../../core/pub/js/qino.js";

cms.initNode("backend.smalltext.export", (el) => {
  const node = apt.cms.node(cms.el.nid(el));
  const result = el.querySelector("[data-result]");

  el.querySelector("[data-action=export]")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    result.textContent = "…";
    try {
      const r = await node.api.post({ export: 1 });
      result.textContent = r?.written?.length
        ? `${r.written.length} files written`
        : "nothing exported";
    } finally {
      e.target.disabled = false;
    }
  });
});
