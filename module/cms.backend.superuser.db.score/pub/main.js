import { nodePanel } from "@qino/m/cms.backend/pub/js/node.mjs";

cms.initNode("backend.superuser.score", (el) => {
  const { execute, refresh, alert } = nodePanel(el, ["list"]);

  el.addEventListener("click", (event) => {
    const prune = event.target.closest("[data-prune]");
    const reload = event.target.closest("[data-refresh]");
    if (prune) execute(prune, { prune: true });
    else if (reload) refresh().catch((e) => alert(e?.message || String(e)));
  });
});
