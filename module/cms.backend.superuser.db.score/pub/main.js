import { nodePanel } from "@qino/m/cms.backend/pub/js/node.mjs";
import { initNode } from "@qino/m/cms/pub/js/cms.js";

initNode("backend.superuser.db.score", (el) => {
  const { execute, refresh, alert } = nodePanel(el, ["list"]);

  el.addEventListener("click", (event) => {
    const prune = event.target.closest("[data-prune]");
    const reload = event.target.closest("[data-refresh]");
    if (prune) execute(prune, { prune: true });
    else if (reload) refresh().catch((e) => alert(e?.message || String(e)));
  });
});
