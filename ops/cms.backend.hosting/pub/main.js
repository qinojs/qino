import { nodePanel } from "@qino/m/cms.backend/pub/js/node.mjs";

cms.initNode("backend.hosting", (el) => {
  const { refresh, alert: show } = nodePanel(el, ["list"]);

  el.addEventListener("click", (event) => {
    if (event.target.closest("[data-refresh]")) refresh().catch((e) => show(e?.message || String(e)));
  });
});
